#!/usr/bin/env node
/**
 * Arqueo de aislamiento entre negocios (multi-tenant / IDOR).
 *
 * Por qué existe: este backend NO tiene extensión ni middleware de Prisma que
 * inyecte `tenantId`. El aislamiento entre negocios depende por completo de que
 * cada consulta lo escriba a mano. Con ~85 modelos que llevan `tenantId`, eso
 * es imposible de sostener a ojo: basta un `findUnique({ where: { id } })` en
 * una ruta autenticada para que el dueño del negocio A lea o modifique la fila
 * del negocio B. El JWT dice quién eres y el RolesGuard qué tipo de cosas
 * puedes hacer, pero nada comprueba que el OBJETO que pides es tuyo.
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

/** Claves por las que se filtra, para saber si se apoya en un identificador
 *  opaco (id/code/slug/token): esas son las que dejan saltar de negocio. */
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

const ACOTA = /tenantId|allyBusinessId|deliveryCompanyId|campaignId|whiteLabelId/;

/** ¿La función acota el negocio en ALGUNA parte de su cuerpo? Cubre el
 *  where compuesto, la comparación explícita y el parámetro tenantId. */
function funcionAcotaTenant(fn) {
  if (!fn) return false;
  return ACOTA.test(fn.getText());
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
    if (ts.isMethodDeclaration(n) && n.name) {
      mapa.set(n.name.getText(), ACOTA.test(n.getText()));
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return mapa;
}

/** ¿La función delega la comprobación en un método del mismo servicio que sí
 *  acota? Heurística deliberada: no verifica que le pase EL MISMO id, así que
 *  puede tapar un caso real. Por eso los delegados se listan aparte con
 *  --delegados, para revisarlos a mano en vez de darlos por buenos. */
function delegaEnMetodoQueAcota(fn, mapa) {
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
      if (mapa.get(nombre) === true) {
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
      const acotaTenant = arg ? mencionaTenant(arg) : false;

      if (!acotaTenant) {
        const claves = where ? claveDelWhere(where) : [];
        const porIdOpaco = claves.some((k) => /^(id|code|slug|token|uuid|publicId|\w+Id)$/i.test(k));
        // create/createMany sin tenantId es otro problema (fila huérfana), no IDOR.
        const esCreacion = call.op === 'create' || call.op === 'createMany';
        // findMany sin where ni tenantId = listado global: se lo lleva TODO.
        const listadoGlobal = call.op === 'findMany' && !where;

        if (porIdOpaco || listadoGlobal || (!where && !esCreacion)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          const fn = funcionContenedora(node);
          // Si la función entera no nombra el negocio ni una vez, nada la acota:
          // ni antes de la consulta ni después. Ese es el hallazgo de verdad.
          const cubierto = funcionAcotaTenant(fn);
          const delegado = cubierto ? null : delegaEnMetodoQueAcota(fn, acotanAqui);
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
  ].filter(Boolean).join(' ');
  return `  ${h.archivo}:${h.linea}  ${h.fn}() ${h.modelo}.${h.op}(${h.claves.join(', ')})  [${marcas}]`;
};

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
