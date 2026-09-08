#!/usr/bin/env node
/**
 * Matriz de roles contra la API (fase 12).
 *
 * Por qué existe, y está en una sola línea de
 * `src/common/guards/roles.guard.ts`:
 *
 *     if (!required || required.length === 0) return true;
 *
 * Un endpoint sin `@Roles(...)` lo puede llamar **cualquier usuario
 * autenticado**: un afiliado, un repartidor, el empleado «solo pedidos» de otro
 * negocio, el admin de una cuponera. La autorización por rol es opt-in: se te
 * olvida el decorador y el endpoint queda abierto a todos los que tengan sesión.
 *
 * Eso no se ve mirando la UI —el botón no está— pero la API responde igual.
 * Por eso el documento pide la matriz «contra la API, no contra la UI».
 *
 * Qué hace: lista los endpoints autenticados SIN `@Roles`, ordenados por daño,
 * y saca la matriz de qué rol llega a qué.
 *
 * Qué NO hace: decidir. Hay endpoints que deben ser para cualquier sesión
 * (`/users/me`, cambiar tu propia contraseña). Esto ORDENA la revisión.
 *
 *   node scripts/arqueo-roles.cjs            # los que no tienen @Roles
 *   node scripts/arqueo-roles.cjs --matriz   # qué alcanza cada rol
 *   node scripts/arqueo-roles.cjs --json
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const argOpcion = (nombre) => {
  const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
  return a ? a.slice(nombre.length + 3) : null;
};
const SRC = argOpcion('src') ? path.resolve(argOpcion('src')) : path.join(ROOT, 'src');

const METODOS = { Get: 'GET', Post: 'POST', Patch: 'PATCH', Put: 'PUT', Delete: 'DELETE' };
const ESCRIBEN = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Endpoints que SÍ deben estar abiertos a cualquier sesión: son sobre uno
 *  mismo. Se listan aparte para que no tapen a los demás. */
const SOBRE_UNO_MISMO = /^\/users\/me|^\/auth\/(me|logout|2fa)|^\/notifications\/devices/;

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

/** { nombre, args[] } del decorador. `@Roles('A','B')` -> args ['A','B']. */
function leerDecorador(d) {
  const e = d.expression;
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    return {
      nombre: e.expression.text,
      arg: e.arguments[0] && ts.isStringLiteral(e.arguments[0]) ? e.arguments[0].text : '',
      args: e.arguments.filter((a) => ts.isStringLiteral(a)).map((a) => a.text),
    };
  }
  if (ts.isIdentifier(e)) return { nombre: e.text, arg: '', args: [] };
  return null;
}

const endpoints = [];

for (const file of archivosControlador(SRC)) {
  const texto = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, texto, ts.ScriptTarget.Latest, true);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  const visitarClase = (clase) => {
    let base = '';
    let rolesClase = null;
    let publicaToda = false;
    for (const d of decoradores(clase)) {
      const dec = leerDecorador(d);
      if (!dec) continue;
      if (dec.nombre === 'Controller') base = dec.arg;
      if (dec.nombre === 'Public') publicaToda = true;
      if (dec.nombre === 'Roles') rolesClase = dec.args;
    }

    for (const m of clase.members) {
      if (!ts.isMethodDeclaration(m) || !m.name) continue;
      const decs = decoradores(m).map(leerDecorador).filter(Boolean);
      const verbo = decs.find((d) => METODOS[d.nombre]);
      if (!verbo) continue;

      // Las públicas son asunto de la fase 10, no de esta.
      if (publicaToda || decs.some((d) => d.nombre === 'Public')) continue;

      const rolesMetodo = decs.find((d) => d.nombre === 'Roles');
      // El Reflector usa getAllAndOverride: el del método pisa al de la clase.
      const roles = rolesMetodo ? rolesMetodo.args : rolesClase;
      const ruta = ('/' + [base, verbo.arg].filter(Boolean).join('/')).replace(/\/+/g, '/');

      endpoints.push({
        archivo: rel,
        linea: sf.getLineAndCharacterOfPosition(m.getStart()).line + 1,
        handler: m.name.getText(),
        metodo: METODOS[verbo.nombre],
        ruta,
        roles: roles && roles.length ? roles : null,
        escribe: ESCRIBEN.has(METODOS[verbo.nombre]),
        sobreUnoMismo: SOBRE_UNO_MISMO.test(ruta),
      });
    }
  };

  const walk = (n) => {
    if (ts.isClassDeclaration(n)) visitarClase(n);
    ts.forEachChild(n, walk);
  };
  walk(sf);
}

if (endpoints.length === 0) {
  console.error('\nEl arqueo no esta viendo el codigo: 0 endpoints autenticados.\n');
  process.exit(1);
}

const sinRoles = endpoints.filter((e) => !e.roles);
const abiertos = sinRoles.filter((e) => !e.sobreUnoMismo);
const propios = sinRoles.filter((e) => e.sobreUnoMismo);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ endpoints, abiertos }, null, 2));
  process.exit(0);
}

if (process.argv.includes('--matriz')) {
  const porRol = new Map();
  for (const e of endpoints) {
    for (const r of e.roles || ['(CUALQUIER SESION)']) {
      porRol.set(r, (porRol.get(r) || 0) + 1);
    }
  }
  console.log('\n=== A CUANTOS ENDPOINTS LLEGA CADA ROL ===\n');
  for (const [rol, n] of [...porRol.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${rol}`);
  }
  console.log('\nOjo: «(CUALQUIER SESION)» no es un rol. Son los endpoints sin');
  console.log('@Roles, a los que llegan TODOS los de arriba a la vez.\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Trinquete para el CI.
//
// Los 15 endpoints sin `@Roles` que hay hoy están BIEN: se revisaron uno a uno
// el 2026-09-07 y todos comprueban el permiso dentro del servicio (los de
// /metrics con `getTid(user, ...)` o comparando `card.tenantId`, y los de
// /devices y /auth/locale son sobre uno mismo).
//
// Lo que no hay es nada que obligue al 16º a hacer lo mismo. El `RolesGuard`
// deja pasar cuando no hay decorador —`if (!required) return true`—, así que un
// endpoint nuevo sin `@Roles` queda abierto a cualquier sesión y no se nota:
// en la UI el botón no está, pero la API responde.
// ---------------------------------------------------------------------------
const BASELINE =
  (argOpcion('baseline') && path.resolve(argOpcion('baseline'))) ||
  path.join(__dirname, 'roles.baseline.json');

const identidad = (e) => `${e.metodo} ${e.ruta}`;
const vigilados = sinRoles.map(identidad).sort();

if (process.argv.includes('--sellar')) {
  fs.writeFileSync(BASELINE, JSON.stringify({ sinRoles: vigilados }, null, 2) + '\n');
  console.log(`\nTecho sellado: ${vigilados.length} endpoints sin @Roles.`);
  console.log(`Escrito en ${path.relative(ROOT, BASELINE).replace(/\\/g, '/')}\n`);
  process.exit(0);
}

if (process.argv.includes('--ci')) {
  if (!fs.existsSync(BASELINE)) {
    console.error('\nNo hay techo sellado. Corre --sellar una vez y commitea el JSON.\n');
    process.exit(1);
  }
  const techo = new Set((JSON.parse(fs.readFileSync(BASELINE, 'utf8')) || {}).sinRoles || []);
  const nuevos = vigilados.filter((v) => !techo.has(v));
  const idos = [...techo].filter((t) => !vigilados.includes(t));

  if (nuevos.length) {
    console.error('\n=== ENDPOINT NUEVO SIN @Roles ===\n');
    for (const n of nuevos) {
      const e = endpoints.find((x) => identidad(x) === n);
      console.error(`  ${n}`);
      if (e) console.error(`      ${e.archivo}:${e.linea} ${e.handler}()`);
    }
    console.error('\nSin @Roles lo alcanza CUALQUIER usuario con sesion: un afiliado, un');
    console.error('repartidor, el empleado de otro negocio. En la UI el boton no esta,');
    console.error('pero la API responde igual.\n');
    console.error('Ponle @Roles(...), o -si de verdad es para cualquier sesion- comprueba');
    console.error('el permiso dentro del servicio y sella explicando por que:\n');
    console.error('  node scripts/arqueo-roles.cjs --sellar\n');
    process.exit(1);
  }

  if (idos.length) {
    console.log('\nYa tienen @Roles (bien). Sella para que no puedan volver a perderlo:\n');
    for (const i of idos) console.log(`  ${i}`);
    console.log('');
  }
  console.log(`Roles: ningun endpoint nuevo sin @Roles (${vigilados.length} vigilados de ${endpoints.length}).`);
  process.exit(0);
}

const escriben = abiertos.filter((e) => e.escribe);

console.log('\n=== ENDPOINTS AUTENTICADOS SIN @Roles ===\n');
console.log(`Endpoints con sesion (no @Public) : ${endpoints.length}`);
console.log(`  con @Roles                      : ${endpoints.length - sinRoles.length}`);
console.log(`  SIN @Roles                      : ${sinRoles.length}`);
console.log(`    de esos, sobre uno mismo      : ${propios.length}   (correcto: /users/me y similares)`);
console.log(`    ABIERTOS A CUALQUIER SESION   : ${abiertos.length}`);
console.log(`      de esos, que ESCRIBEN       : ${escriben.length}   <-- por aqui se empieza\n`);

const full = process.argv.includes('--full');
const lista = full ? abiertos : escriben.slice(0, 30);
console.log(`--- ${full ? 'Todos los abiertos' : 'Los que escriben (top 30)'} ---\n`);
for (const e of lista) {
  console.log(`  ${e.metodo.padEnd(6)} ${e.ruta}`);
  console.log(`         ${e.archivo}:${e.linea} ${e.handler}()`);
}
console.log('');
console.log('Un endpoint sin @Roles lo alcanza CUALQUIER usuario con sesion:');
console.log('un afiliado, un repartidor, el empleado de otro negocio. No se ve');
console.log('en la UI —el boton no esta— pero la API responde igual.\n');
