#!/usr/bin/env node
/**
 * Inventario de las rutas @Public() (fase 10).
 *
 * Por qué existe: son 136 —el documento decía 36, que son los CONTROLADORES— y
 * en la primera tarde que alguien las miró salieron tres huecos reales. Una
 * lista de 136 que hay que revisar a mano no se termina nunca; esto la ordena
 * por daño para que se empiece por el lado correcto y se pueda parar y seguir.
 *
 * Una ruta pública no es un fallo: el menú, el pase o el pedido del cliente
 * TIENEN que abrirse sin sesión. Lo que decide el riesgo es otra cosa:
 *
 *   1. ¿ESCRIBE? Sin sesión, quien acierte la llave modifica datos ajenos.
 *   2. ¿Cuál es la llave y es adivinable? Un uuid no se acierta; un código de
 *      4 caracteres sí — de ahí salió P0-3.
 *   3. ¿Devuelve el objeto entero? Un `return { ...fila }` publica la columna
 *      que alguien añada mañana sin que nadie lo note.
 *
 *   node scripts/arqueo-rutas-publicas.cjs           # resumen por riesgo
 *   node scripts/arqueo-rutas-publicas.cjs --full    # las 136
 *   node scripts/arqueo-rutas-publicas.cjs --json
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
/** `--src=` para poder probarlo con controladores de ejemplo.
 *  Ver `test/arqueo-rutas-publicas.test.ts`. */
const argSrc = process.argv.find((x) => x.startsWith('--src='));
const SRC = argSrc ? path.resolve(argSrc.slice(6)) : path.join(ROOT, 'src');

const METODOS = { Get: 'GET', Post: 'POST', Patch: 'PATCH', Put: 'PUT', Delete: 'DELETE' };
const ESCRIBEN = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Llaves que se aciertan a base de intentarlo, frente a las que no. El uuid y
 *  el hex de 32 no se adivinan; un código corto o un teléfono, sí. */
const LLAVE_DEBIL = /^(code|codigo|pin|slug|phone|telefono|numero|email|correo|ref|shortId)$/i;

/** `@Public()` solo salta el JWT — no significa «abierta a cualquiera». Varias
 *  rutas se autentican por otra vía y marcarlas como agujeros es ruido que
 *  entierra las que sí lo son:
 *
 *    - x-api-key contra TEAM_INTEGRATION_KEY (integración con TeamClubify)
 *    - firma del webhook (Stripe, Hotmart, MercadoPago)
 *
 *  OJO con lo que se mete aquí. La primera versión incluía `firma` y
 *  `signature` sueltos y miraba el texto de la CLASE ENTERA. Resultado: la
 *  palabra «confirmación» dentro de un comentario cualquiera marcaba como
 *  segura la clase entera, y con ella **las 15 rutas `@Public()` de
 *  `/auth/*`** —login, signup, refresh, reset-password, 2FA— más las de
 *  reservas. Es decir: el inventario escondía justo las rutas más sensibles
 *  del sistema, y los números que se publicaron a partir de él eran falsos.
 *
 *  Por eso ahora: límites de palabra, nada de `firma`/`signature` sueltos, y
 *  se mira SOLO el handler más los métodos privados que ese handler invoca. */
const OTRA_AUTENTICACION =
  /\b(apiKey|api_key|assertKey|TEAM_INTEGRATION_KEY|verifyFirma|verificarFirma|verifySignature|constructEvent|checkSignature|createHmac|verificarWebhook)\b|['"]x-api-key['"]/;

/**
 * ¿Este handler concreto se autentica de otra forma? Mira SOLO su cuerpo y los
 * métodos de la misma clase que él invoca (el patrón habitual es un
 * `assertKey()` privado). Nunca la clase entera: un método que valide api-key
 * no dice nada de sus vecinos, y dar por segura una ruta abierta es peor que
 * no mirarla, porque la saca de la lista de pendientes.
 */
function seAutenticaDeOtraForma(metodo, clase) {
  const cuerpo = metodo.getText();
  if (OTRA_AUTENTICACION.test(cuerpo)) return true;

  // Métodos de la clase que este handler llama por `this.x()`.
  const invocados = new Set();
  const walk = (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      invocados.add(n.expression.name.text);
    }
    ts.forEachChild(n, walk);
  };
  walk(metodo);
  if (!invocados.size) return false;

  for (const m of clase.members) {
    if (!ts.isMethodDeclaration(m) || !m.name) continue;
    if (!invocados.has(m.name.getText())) continue;
    if (OTRA_AUTENTICACION.test(m.getText())) return true;
  }
  return false;
}

function archivosControlador(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) archivosControlador(p, acc);
    else if (e.name.endsWith('.controller.ts')) acc.push(p);
  }
  return acc;
}

function decoradores(node) {
  return ts.getDecorators ? ts.getDecorators(node) || [] : node.decorators || [];
}

/** Devuelve { nombre, arg } del decorador, p.ej. Get('/:id') -> {nombre:'Get', arg:'/:id'} */
function leerDecorador(d) {
  const e = d.expression;
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    const arg = e.arguments[0];
    return {
      nombre: e.expression.text,
      arg: arg && ts.isStringLiteral(arg) ? arg.text : '',
    };
  }
  if (ts.isIdentifier(e)) return { nombre: e.text, arg: '' };
  return null;
}

const rutas = [];

for (const file of archivosControlador(SRC)) {
  const texto = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, texto, ts.ScriptTarget.Latest, true);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  const visitarClase = (clase) => {
    const textoClase = clase.getText();
    let base = '';
    let publicaToda = false;
    for (const d of decoradores(clase)) {
      const dec = leerDecorador(d);
      if (!dec) continue;
      if (dec.nombre === 'Controller') base = dec.arg;
      if (dec.nombre === 'Public') publicaToda = true;
    }

    for (const m of clase.members) {
      if (!ts.isMethodDeclaration(m) || !m.name) continue;
      const decs = decoradores(m).map(leerDecorador).filter(Boolean);
      const esPublica = publicaToda || decs.some((d) => d.nombre === 'Public');
      if (!esPublica) continue;

      const verbo = decs.find((d) => METODOS[d.nombre]);
      if (!verbo) continue;

      const sub = verbo.arg;
      const ruta = ('/' + [base, sub].filter(Boolean).join('/')).replace(/\/+/g, '/');

      // Los @Param del handler son la llave que abre la ruta.
      const params = [];
      for (const p of m.parameters) {
        for (const d of decoradores(p)) {
          const dec = leerDecorador(d);
          if (dec && (dec.nombre === 'Param' || dec.nombre === 'Query')) {
            params.push({ tipo: dec.nombre, nombre: dec.arg || p.name.getText() });
          }
        }
      }

      const cuerpo = m.getText();
      const throttle = decs.find((d) => d.nombre === 'Throttle');
      const llaves = params.filter((p) => p.tipo === 'Param').map((p) => p.nombre);

      rutas.push({
        archivo: rel,
        linea: sf.getLineAndCharacterOfPosition(m.getStart()).line + 1,
        handler: m.name.getText(),
        metodo: METODOS[verbo.nombre],
        ruta,
        llaves,
        query: params.filter((p) => p.tipo === 'Query').map((p) => p.nombre),
        escribe: ESCRIBEN.has(METODOS[verbo.nombre]),
        llaveDebil: llaves.some((k) => LLAVE_DEBIL.test(k)),
        sinLlave: llaves.length === 0,
        throttle: !!throttle,
        otraAuth: seAutenticaDeOtraForma(m, clase),
        // `return { ...algo }` publica la fila entera: el fallo de P0-3.
        derramaObjeto: /return\s*\{\s*\.\.\./.test(cuerpo),
      });
    }
  };

  const walk = (n) => {
    if (ts.isClassDeclaration(n)) visitarClase(n);
    ts.forEachChild(n, walk);
  };
  walk(sf);
}

// Escribir sin sesión es lo peor; después, que la llave se pueda acertar a base
// de intentarlo; después, devolver la fila entera. El límite de peticiones no
// resta hoy porque NINGUNO funciona (P0-2), pero se anota para cuando funcionen.
const puntua = (r) =>
  (r.otraAuth ? 0 : 1) *
  ((r.escribe ? 4 : 0) + (r.llaveDebil ? 3 : 0) + (r.derramaObjeto ? 2 : 0) + (r.sinLlave ? 0 : 1));

rutas.sort((a, b) => puntua(b) - puntua(a) || a.archivo.localeCompare(b.archivo));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rutas, null, 2));
  process.exit(0);
}

const conOtraAuth = rutas.filter((r) => r.otraAuth);
const abiertas = rutas.filter((r) => !r.otraAuth);
const escriben = abiertas.filter((r) => r.escribe);
const debiles = abiertas.filter((r) => r.llaveDebil);
const derraman = rutas.filter((r) => r.derramaObjeto);
const conThrottle = rutas.filter((r) => r.throttle);

console.log('\n=== RUTAS PUBLICAS (@Public) ===\n');
console.log(`Total                                  : ${rutas.length}`);
console.log(`  con otra autenticacion (api-key/firma): ${conOtraAuth.length}   <- no son agujeros`);
console.log(`  ABIERTAS de verdad                   : ${abiertas.length}`);
console.log(`    de esas, que ESCRIBEN              : ${escriben.length}   <-- por aqui se empieza`);
console.log(`  se abren con una llave adivinable    : ${debiles.length}`);
console.log(`  devuelven el objeto entero (...spread): ${derraman.length}`);
console.log(`  con @Throttle (hoy decorativo, P0-2) : ${conThrottle.length}\n`);

const fmt = (r) => {
  const marcas = [
    r.escribe ? 'ESCRIBE' : 'lee',
    r.llaveDebil ? 'LLAVE-DEBIL' : null,
    r.derramaObjeto ? 'DERRAMA-OBJETO' : null,
    r.sinLlave ? 'sin-llave' : null,
    r.throttle ? 'throttle' : null,
    r.otraAuth ? 'OTRA-AUTH' : null,
  ]
    .filter(Boolean)
    .join(' ');
  // La ruta ya lleva los :param dentro; repetirlos detrás solo confunde.
  const extra = r.llaves.filter((k) => !r.ruta.includes(`:${k}`));
  const llaves = extra.length ? `  (+${extra.join(',')})` : '';
  return `  ${r.metodo.padEnd(6)} ${r.ruta}${llaves}\n         ${r.archivo}:${r.linea} ${r.handler}()  [${marcas}]`;
};

const full = process.argv.includes('--full');
const lista = full ? rutas : abiertas.filter((r) => r.escribe).slice(0, 25);
console.log(`--- ${full ? `Las ${rutas.length}, por riesgo` : 'Las 25 de mayor riesgo'} ---\n`);
for (const r of lista) console.log(fmt(r));
console.log('');
