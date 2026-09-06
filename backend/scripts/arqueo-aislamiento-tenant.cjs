#!/usr/bin/env node
/**
 * Arqueo de aislamiento entre negocios (multi-tenant / IDOR).
 *
 * Por qué existe: SÍ hay un middleware de Prisma que inyecta `tenantId`
 * —`src/common/prisma/prisma-tenant-middleware.ts`, registrado en
 * `prisma.service.ts:17`— y SÍ funciona en los requests HTTP autenticados.
 * Comprobado el 2026-09-05 levantando una app Nest con el mismo patrón de
 * interceptor: el contexto del AsyncLocalStorage llega al handler incluso
 * después de varios `await`. (El comentario de `test/tenant-isolation.e2e.test.ts`
 * ya lo decía, y tiene razón: lo que falla es el contexto DENTRO del test,
 * no el del request real.)
 *
 * Lo que este arqueo cubre son los agujeros que el propio middleware declara
 * en su cabecera y que no puede tapar:
 *
 *   - `update` / `delete` / `upsert` SINGULARES. Prisma no admite un filtro
 *     no-único en su `where`, así que el middleware no puede inyectar nada.
 *     Son justo las operaciones que ESCRIBEN.
 *   - Todo lo que corre sin contexto: crons, scripts, colas, y lo envuelto en
 *     `TenantContext.runWithoutTenant()`.
 *   - `role === MARKETING` y `SUPER_ADMIN`, que lo saltan por diseño.
 *
 * Es decir: el JWT dice quién eres, el RolesGuard qué tipo de cosas puedes
 * hacer, y el middleware acota casi todo... menos la escritura por id, que es
 * la que más duele. Ahí solo queda que alguien se acuerde de escribirlo a mano.
 *
 * Qué hace: recorre el AST de los .ts, encuentra las llamadas a Prisma sobre
 * modelos que tienen `tenantId`, y marca las que se filtran por identificador
 * sin acotar el negocio.
 *
 * Qué NO hace: decidir. Un `findUnique` por id seguido de un
 * `if (x.tenantId !== tenantId) throw` es correcto, y el auditor lo detecta
 * como atenuante pero no puede garantizar que sea equivalente. Esto ORDENA el
 * trabajo de revisión; la confirmación es a mano, ruta por ruta.
 *
 *   node scripts/arqueo-aislamiento-tenant.cjs            # resumen
 *   node scripts/arqueo-aislamiento-tenant.cjs --full     # todos los casos
 *   node scripts/arqueo-aislamiento-tenant.cjs --json     # para diffear
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const SCHEMA = path.join(ROOT, 'prisma', 'schema.prisma');

const ESCRITURA = new Set(['update', 'delete', 'upsert', 'updateMany', 'deleteMany']);
const LECTURA = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
]);
const OPS = new Set([...ESCRITURA, ...LECTURA, 'count', 'aggregate', 'create', 'createMany']);

/** Modelos del schema que llevan tenantId, y el nombre con el que Prisma Client
 *  los expone (primera letra minúscula). */
function modelosConTenant() {
  const txt = fs.readFileSync(SCHEMA, 'utf8');
  const conTenant = new Map(); // nombre en el client -> nombre del modelo
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(txt))) {
    const [, nombre, cuerpo] = m;
    const client = nombre[0].toLowerCase() + nombre.slice(1);
    if (/^\s*tenantId\s+/m.test(cuerpo)) conTenant.set(client, nombre);
  }
  return conTenant;
}

function archivosTs(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) archivosTs(p, acc);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') && !e.name.endsWith('.spec.ts')) {
      acc.push(p);
    }
  }
  return acc;
}

/** `this.prisma.order.findUnique` / `tx.order.update` / `prisma.order.findMany`
 *  -> { modelo: 'order', op: 'findUnique' }. Devuelve null si no encaja. */
function llamadaPrisma(node) {
  if (!ts.isCallExpression(node)) return null;
  const fn = node.expression;
  if (!ts.isPropertyAccessExpression(fn)) return null;
  const op = fn.name.text;
  if (!OPS.has(op)) return null;
  const owner = fn.expression;
  if (!ts.isPropertyAccessExpression(owner)) return null;
  const modelo = owner.name.text;
  // El portador debe parecer un cliente de Prisma: this.prisma, prisma, tx, this.db...
  const base = owner.expression.getText().trim();
  if (!/(^|\.)(prisma|tx|db|client)$/i.test(base)) return null;
  return { modelo, op };
}

/** Aparece la clave `tenantId` en alguna parte del objeto, a cualquier
 *  profundidad. Cubre `where: { tenantId }`, `{ tenantId_phone: {...} }`,
 *  `AND: [{ tenantId }]` y los compuestos. */
function mencionaTenant(node) {
  let visto = false;
  const walk = (n) => {
    if (visto || !n) return;
    if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) {
      const k = n.name.getText();
      if (/^tenant(Id)?$/.test(k) || /^tenantId_/.test(k) || /tenantId/.test(k)) {
        visto = true;
        return;
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return visto;
}

/** `where: { id: user.id }` no es un salto entre negocios: es el usuario de la
 *  sesión leyendo o tocando su propia fila. Sale mucho —cambiar la contraseña,
 *  el perfil, el idioma, el 2FA, la sede del empleado— y si el arqueo lo marca,
 *  el CI se pone rojo por código correcto una y otra vez. Un candado que da
 *  falsos rojos se acaba sellando a ciegas, y entonces ya no candado nada. */
function esSobreSiMismo(whereNode) {
  if (!whereNode) return false;
  let propio = false;
  const walk = (n) => {
    if (propio || !n) return;
    if (ts.isPropertyAssignment(n) && /^(id|userId)$/.test(n.name.getText())) {
      const v = n.initializer;
      if (ts.isPropertyAccessExpression(v) && v.name.text === 'id') {
        // user.id, usuario.id, currentUser.id, u.id, req.user.id…
        if (/^(user|usuario|currentUser|u|me|actor)$/i.test(v.expression.getText().split('.').pop() || '')) {
          propio = true;
          return;
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(whereNode);
  return propio;
}

/** Claves por las que se filtra, para saber si se apoya en un identificador
 *  opaco (id/code/slug/token): esas son las que dejan saltar de negocio.
 *
 *  Sin la `i` a propósito: con ella, `\w+Id$` casaba `paid`, `valid` y `void`,
 *  y un `where: { paid: true }` habría salido como si filtrara por un id. */
function claveDelWhere(whereNode) {
  const claves = [];
  const walk = (n) => {
    if (!n) return;
    if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) {
      claves.push(n.name.getText());
    }
    ts.forEachChild(n, walk);
  };
  walk(whereNode);
  return claves;
}

/** Sube por el AST hasta el método o función que contiene la llamada.
 *  Sin esto el arqueo es inservible: el patrón dominante del repo es
 *  «comprobar primero, escribir después» —un findFirst({ id, tenantId }) y
 *  luego un update({ id })— y mirar solo las líneas siguientes a la consulta
 *  marcaba ese patrón CORRECTO como si fuera un agujero. De los 3 primeros
 *  casos revisados a mano, los 3 eran esto. */
function funcionContenedora(node) {
  let n = node.parent;
  while (n) {
    if (
      ts.isMethodDeclaration(n) ||
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isConstructorDeclaration(n)
    ) {
      // Una arrow suelta (callback de un map, un $transaction) no es la unidad
      // de decisión: seguimos subiendo hasta el método de verdad.
      if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
        const arriba = funcionContenedora(n);
        if (arriba) return arriba;
      }
      return n;
    }
    n = n.parent;
  }
  return null;
}

// `tenantId` es el negocio. `campaignId` es un objeto DENTRO de un negocio y
// `whiteLabelId` es una marca con N negocios: aceptarlos para cualquier modelo
// blanqueaba 57 consultas sobre Customer, User y Card por tocar una campana.
// Solo valen como ambito para los modelos de los que SON la clave.
const ACOTA = /tenantId/;
const AMBITO_PROPIO = {
  Delivery: /deliveryCompanyId/,
  AllyBusiness: /campaignId|allyBusinessId/,
  Benefit: /campaignId/,
  BenefitCampaign: /campaignId/,
  Redemption: /campaignId/,
};

/** ¿La función acota el negocio en ALGUNA parte de su cuerpo? Cubre el
 *  where compuesto, la comparación explícita y el parámetro tenantId. */
function funcionAcotaTenant(fn, modelo) {
  if (!fn) return false;
  const texto = textoSinLiterales(fn);
  if (ACOTA.test(texto)) return true;
  const propio = AMBITO_PROPIO[modelo];
  return propio ? propio.test(texto) : false;
}

/** El texto de la funcion sin comentarios ni cadenas. Sin esto, un
 *  `logger.debug('tenantId ...')` o un `// aqui no aplica tenantId` bastaba
 *  para dar por acotada una consulta que no lo estaba. */
function textoSinLiterales(fn) {
  let out = '';
  const walk = (n) => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      n.kind === ts.SyntaxKind.TemplateHead ||
      n.kind === ts.SyntaxKind.TemplateMiddle ||
      n.kind === ts.SyntaxKind.TemplateTail
    ) {
      return; // se salta el literal entero
    }
    if (n.getChildCount() === 0) {
      out += ' ' + n.getText();
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(fn);
  return out;
}

/** Métodos del archivo que sí acotan, para poder seguir la delegación.
 *  El tercer patrón del repo (además del where compuesto y del
 *  comprobar-antes-de-escribir) es el guard delegado: `update()` no comprueba
 *  nada, llama a `this.get(user, id)` y ES ESE el que lanza Forbidden si la
 *  fila es de otro negocio. Sin seguir esa llamada, products, badges y medio
 *  catálogo salían como agujeros siendo correctos. */
function metodosQueAcotan(sf) {
  const mapa = new Map();
  const walk = (n) => {
    // Se indexa por Clase.metodo: 98 archivos tienen mas de una clase, y con
    // solo el nombre un `update()` de una clase excusaba el de la otra.
    if (ts.isClassDeclaration(n) && n.name) {
      const clase = n.name.getText();
      for (const m of n.members) {
        if (ts.isMethodDeclaration(m) && m.name) {
          mapa.set(`${clase}.${m.name.getText()}`, ACOTA.test(textoSinLiterales(m)));
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return mapa;
}

/** La clase que contiene un nodo, para resolver `this.x()` sin colisiones. */
function claseContenedora(node) {
  let n = node.parent;
  while (n) {
    if (ts.isClassDeclaration(n) && n.name) return n.name.getText();
    n = n.parent;
  }
  return '';
}

/** ¿La función delega la comprobación en un método del mismo servicio que sí
 *  acota? Heurística deliberada: no verifica que le pase EL MISMO id, así que
 *  puede tapar un caso real. Por eso los delegados se listan aparte con
 *  --delegados, para revisarlos a mano en vez de darlos por buenos. */
function delegaEnMetodoQueAcota(fn, mapa, clase) {
  if (!fn) return null;
  let encontrado = null;
  const walk = (n) => {
    if (encontrado || !n) return;
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      const nombre = n.expression.name.text;
      if (mapa.get(`${clase}.${nombre}`) === true) {
        encontrado = nombre;
        return;
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(fn);
  return encontrado;
}

function propiedad(objNode, nombre) {
  if (!objNode || !ts.isObjectLiteralExpression(objNode)) return null;
  for (const p of objNode.properties) {
    const esProp = ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p);
    if (esProp && p.name.getText() === nombre) {
      return ts.isPropertyAssignment(p) ? p.initializer : p.name;
    }
  }
  return null;
}

const conTenant = modelosConTenant();
const hallazgos = [];

for (const file of archivosTs(SRC)) {
  const texto = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, texto, ts.ScriptTarget.Latest, true);
  const acotanAqui = metodosQueAcotan(sf);

  const visit = (node) => {
    const call = llamadaPrisma(node);
    if (call && conTenant.has(call.modelo)) {
      const arg = node.arguments[0];
      const where = propiedad(arg, 'where');
      // Solo el `where` acota de verdad. Mirar el argumento entero hacia que
      // un `include: { tenant: ... }` o un `select: { tenantId: true }`
      // excusaran la consulta sin filtrar nada: 78 consultas se libraban asi.
      const esCreacionOp = call.op === 'create' || call.op === 'createMany';
      const acotaTenant = where
        ? mencionaTenant(where)
        : esCreacionOp && arg
          ? mencionaTenant(propiedad(arg, 'data') || arg)
          : false;

      if (!acotaTenant && !esSobreSiMismo(where)) {
        const claves = where ? claveDelWhere(where) : [];
        const porIdOpaco = claves.some((k) =>
          /^(id|code|slug|token|uuid|publicId|serialNumber|manageToken|qrToken|tokenHash|email|phone|\w+Id)$/.test(k),
        );
        // create/createMany sin tenantId es otro problema (fila huérfana), no IDOR.
        const esCreacion = call.op === 'create' || call.op === 'createMany';
        // findMany sin where ni tenantId = listado global: se lo lleva TODO.
        const listadoGlobal = call.op === 'findMany' && !where;

        if (porIdOpaco || listadoGlobal || (!where && !esCreacion)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          const fn = funcionContenedora(node);
          // Si la función entera no nombra el negocio ni una vez, nada la acota:
          // ni antes de la consulta ni después. Ese es el hallazgo de verdad.
          const modelo = conTenant.get(call.modelo);
          const cubierto = funcionAcotaTenant(fn, modelo);
          const delegado = cubierto
            ? null
            : delegaEnMetodoQueAcota(fn, acotanAqui, claseContenedora(node));
          const nombreFn = fn && fn.name ? fn.name.getText() : '(anonima)';

          hallazgos.push({
            archivo: path.relative(ROOT, file).replace(/\\/g, '/'),
            linea: line + 1,
            fn: nombreFn,
            modelo: conTenant.get(call.modelo),
            op: call.op,
            claves: [...new Set(claves)].slice(0, 6),
            escribe: ESCRITURA.has(call.op),
            listadoGlobal,
            acota: cubierto,
            delegado,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// Riesgo: escribir en la fila de otro negocio es peor que leerla; y un caso que
// nadie acota es peor que uno cubierto por delegacion.
const puntua = (h) => (h.escribe ? 2 : 0) + (h.acota || h.delegado ? 0 : 3) + (h.listadoGlobal ? 1 : 0);
hallazgos.sort((a, b) => puntua(b) - puntua(a) || a.archivo.localeCompare(b.archivo));

const cubiertos = hallazgos.filter((h) => h.acota);
const delegados = hallazgos.filter((h) => !h.acota && h.delegado);
const huerfanos = hallazgos.filter((h) => !h.acota && !h.delegado);
const escrituras = huerfanos.filter((h) => h.escribe);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ cubiertos, delegados, huerfanos }, null, 2));
  process.exit(0);
}

const linea = (h) => {
  const marcas = [
    h.escribe ? 'ESCRIBE' : 'lee',
    h.listadoGlobal ? 'LISTADO-GLOBAL' : null,
    h.delegado ? `delega->${h.delegado}()` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return `  ${h.archivo}:${h.linea}  ${h.fn}() ${h.modelo}.${h.op}(${h.claves.join(', ')})  [${marcas}]`;
};

// ---------------------------------------------------------------------------
// Trinquete para el CI.
//
// Las consultas que hoy acotan bien el negocio no lo hacen por ningún mecanismo:
// lo hacen porque alguien se acordó, una por una. Este modo no arregla ninguna
// —no hace falta, están bien— sino que impide que entre la siguiente que no
// acote. Es la diferencia entre «esperemos que nadie se equivoque» y «no se
// puede fusionar si te equivocas».
//
// El techo es POR ARCHIVO a propósito: con un número global, arreglar una
// consulta en un sitio daría margen para colar una mala en otro, y el CI se
// quedaría callado.
//
//   node scripts/arqueo-aislamiento-tenant.cjs --ci        # falla si sube
//   node scripts/arqueo-aislamiento-tenant.cjs --sellar    # tras revisar a mano
// ---------------------------------------------------------------------------
const BASELINE = path.join(__dirname, 'aislamiento-tenant.baseline.json');

// Los delegados cuentan para el techo. La delegacion NO comprueba que el guard
// reciba el mismo id: basta un `this.loQueSea()` que mencione tenantId para que
// la consulta desapareciera del CI. Son «por revisar», no «correctas», y
// dejarlas fuera era un agujero por el que colar cualquier cosa.
const vigiladas = [...huerfanos, ...delegados];
const conteoActual = {};
for (const h of vigiladas) conteoActual[h.archivo] = (conteoActual[h.archivo] || 0) + 1;

if (process.argv.includes('--sellar')) {
  fs.writeFileSync(BASELINE, JSON.stringify(conteoActual, null, 2) + '\n');
  console.log(
    `\nTecho sellado: ${vigiladas.length} consultas vigiladas ` +
      `(${huerfanos.length} que nadie acota + ${delegados.length} delegadas) ` +
      `en ${Object.keys(conteoActual).length} archivos.`,
  );
  console.log(`Escrito en ${path.relative(ROOT, BASELINE).replace(/\\/g, '/')}\n`);
  process.exit(0);
}

if (process.argv.includes('--ci')) {
  if (!fs.existsSync(BASELINE)) {
    console.error('\nNo hay techo sellado. Corre --sellar una vez y commitea el JSON.\n');
    process.exit(1);
  }
  const techo = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const subieron = [];
  const bajaron = [];
  for (const archivo of new Set([...Object.keys(techo), ...Object.keys(conteoActual)])) {
    const antes = techo[archivo] || 0;
    const ahora = conteoActual[archivo] || 0;
    if (ahora > antes) subieron.push({ archivo, antes, ahora });
    else if (ahora < antes) bajaron.push({ archivo, antes, ahora });
  }

  if (subieron.length) {
    console.error('\n=== AISLAMIENTO ENTRE NEGOCIOS: hay consultas nuevas que no acotan ===\n');
    for (const s of subieron) {
      console.error(`  ${s.archivo}   ${s.antes} -> ${s.ahora}`);
      for (const h of vigiladas.filter((x) => x.archivo === s.archivo)) console.error(linea(h));
      console.error('');
    }
    console.error('Una consulta sobre un modelo con tenantId que se filtra por id y no acota');
    console.error('el negocio deja que el dueño de un negocio lea o escriba la fila de otro.');
    console.error('Acótala con tenantId, o comprueba el dueño antes de escribir. Si tras');
    console.error('revisarla a mano es correcta (guard delegado, id interno, usuario sobre sí');
    console.error('mismo), sella el techo con --sellar y explica por qué en el commit.\n');
    process.exit(1);
  }

  if (bajaron.length) {
    console.log('\nBajaron (bien). Sella el techo para que no puedan volver a subir:\n');
    for (const b of bajaron) console.log(`  ${b.archivo}   ${b.antes} -> ${b.ahora}`);
    console.log('\n  node scripts/arqueo-aislamiento-tenant.cjs --sellar\n');
  }

  console.log(`Aislamiento entre negocios: sin consultas nuevas sin acotar (techo ${vigiladas.length}).`);
  process.exit(0);
}

console.log('\n=== ARQUEO DE AISLAMIENTO ENTRE NEGOCIOS ===\n');
console.log(`Modelos con tenantId en el schema  : ${conTenant.size}`);
console.log(`Consultas sin tenantId en el where : ${hallazgos.length}`);
console.log(`  la funcion SI acota (correctas)  : ${cubiertos.length}`);
console.log(`  delegan en un guard (revisar)    : ${delegados.length}`);
console.log(`  NADIE las acota                  : ${huerfanos.length}`);
console.log(`    de esas, que ESCRIBEN          : ${escrituras.length}   <-- por aqui se empieza\n`);

const porArchivo = new Map();
for (const h of huerfanos) porArchivo.set(h.archivo, (porArchivo.get(h.archivo) || 0) + 1);
console.log('--- Archivos con mas casos que nadie acota ---');
for (const [a, n] of [...porArchivo.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15)) {
  console.log(`  ${String(n).padStart(3)}  ${a}`);
}

if (process.argv.includes('--delegados')) {
  console.log(`
--- Delegan en un guard: correctos SI el guard recibe el mismo id (${delegados.length}) ---`);
  for (const h of delegados) console.log(linea(h));
  console.log('');
  process.exit(0);
}

const full = process.argv.includes('--full');
const lista = full ? huerfanos : escrituras.slice(0, 40);
console.log(`
--- ${full ? 'Todo lo que nadie acota' : 'Escrituras que nadie acota (top 40)'} ---`);
for (const h of lista) console.log(linea(h));
console.log('');
