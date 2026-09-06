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
const argOpcion = (nombre) => {
  const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
  return a ? a.slice(nombre.length + 3) : null;
};
const SRC = argOpcion('src') ? path.resolve(argOpcion('src')) : path.join(ROOT, 'src');
const BASELINE =
  (argOpcion('baseline') && path.resolve(argOpcion('baseline'))) ||
  path.join(__dirname, 'rutas-publicas.baseline.json');

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
  // Un `@UseGuards(...)` explícito en el método o en la clase es autenticación
  // de pleno derecho, y no la veía: las 11 rutas de `/sync/*` salían como
  // abiertas cuando las cubre `OnboardingTokenGuard`, que exige
  // `Authorization: Bearer` y resuelve el negocio DESDE el token, nunca del
  // body. En este repo solo hay un `@UseGuards` —los demás guards son
  // globales—, así que el caso es raro, pero marcar como abierta una ruta
  // protegida mete ruido en la lista que hay que revisar a mano.
  const tieneGuard = (n) =>
    decoradores(n).some((d) => {
      const dec = leerDecorador(d);
      return dec && dec.nombre === 'UseGuards';
    });
  if (tieneGuard(metodo) || tieneGuard(clase)) return true;

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

// En el CI el resumen es ruido: lo único que importa allí es el veredicto.
const modoCandado = process.argv.includes('--ci') || process.argv.includes('--sellar');
const informar = modoCandado ? () => {} : console.log;

informar('\n=== RUTAS PUBLICAS (@Public) ===\n');
informar(`Total                                  : ${rutas.length}`);
informar(`  con otra autenticacion (api-key/firma): ${conOtraAuth.length}   <- no son agujeros`);
informar(`  ABIERTAS de verdad                   : ${abiertas.length}`);
informar(`    de esas, que ESCRIBEN              : ${escriben.length}   <-- por aqui se empieza`);
informar(`  se abren con una llave adivinable    : ${debiles.length}`);
informar(`  devuelven el objeto entero (...spread): ${derraman.length}`);
informar(`  con @Throttle (hoy decorativo, P0-2) : ${conThrottle.length}\n`);

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

// ---------------------------------------------------------------------------
// Trinquete para el CI.
//
// El inventario ordena el trabajo, pero no impide que entre la ruta publica 151
// sin que nadie la mire. Esto lo impide: el techo guarda las rutas ABIERTAS que
// ESCRIBEN, y si aparece una nueva el CI la nombra y para.
//
// No cuenta: guarda la identidad de cada ruta. Sustituir una por otra no mueve
// un contador, y ese fue justo el fallo del primer trinquete de dependencias.
//
//   node scripts/arqueo-rutas-publicas.cjs --ci       # falla si aparece una nueva
//   node scripts/arqueo-rutas-publicas.cjs --sellar   # tras revisarla a mano
// ---------------------------------------------------------------------------
const identidad = (r) => `${r.metodo} ${r.ruta}`;
const vigiladas = abiertas.filter((r) => r.escribe).map(identidad).sort();

// Si el arqueo deja de ver controladores, no puede dar el visto bueno: diria
// que no hay rutas publicas nuevas porque no ha mirado ninguna.
if (rutas.length === 0) {
  console.error('El arqueo no esta viendo el codigo: 0 rutas @Public().');
  console.error('Revisa que src/ este donde se espera.\n');
  process.exit(1);
}

if (process.argv.includes('--sellar')) {
  fs.writeFileSync(BASELINE, JSON.stringify({ escribenAbiertas: vigiladas }, null, 2) + '\n');
  console.log(`
Techo sellado: ${vigiladas.length} rutas abiertas que escriben.`);
  console.log(`Escrito en ${path.relative(ROOT, BASELINE).replace(/\\/g, '/')}\n`);
  process.exit(0);
}

if (process.argv.includes('--ci')) {
  if (!fs.existsSync(BASELINE)) {
    console.error('No hay techo sellado. Corre --sellar una vez y commitea el JSON.\n');
    process.exit(1);
  }
  const techo = new Set((JSON.parse(fs.readFileSync(BASELINE, 'utf8')) || {}).escribenAbiertas || []);
  const nuevas = vigiladas.filter((v) => !techo.has(v));
  const idas = [...techo].filter((t) => !vigiladas.includes(t));

  if (nuevas.length) {
    console.error('\n=== RUTA PUBLICA NUEVA QUE ESCRIBE SIN AUTENTICAR ===\n');
    for (const n of nuevas) {
      const r = rutas.find((x) => identidad(x) === n);
      console.error(`  ${n}`);
      if (r) console.error(`      ${r.archivo}:${r.linea} ${r.handler}()`);
    }
    console.error('Una ruta @Public() que escribe la puede llamar cualquiera. Antes de');
    console.error('sellarla, responde por escrito: que llave la abre, si es adivinable,');
    console.error('que escribe, y si con la llave de un negocio se toca otro.');
    console.error('Metodo y ejemplos en docs/QA-MASTER-SECURITY.md (P1-2).\n');
    console.error('  node scripts/arqueo-rutas-publicas.cjs --sellar\n');
    process.exit(1);
  }

  if (idas.length) {
    console.log('\nYa no estan (bien). Sella para que no puedan volver sin revisar:\n');
    for (const i of idas) console.log(`  ${i}`);
    console.log('');
  }
  console.log(`Rutas publicas: ninguna nueva que escriba sin autenticar (${vigiladas.length} vigiladas).`);
  process.exit(0);
}

const full = process.argv.includes('--full');
const lista = full ? rutas : abiertas.filter((r) => r.escribe).slice(0, 25);
console.log(`--- ${full ? `Las ${rutas.length}, por riesgo` : 'Las 25 de mayor riesgo'} ---\n`);
for (const r of lista) console.log(fmt(r));
console.log('');
