#!/usr/bin/env node
/**
 * Arqueo de dependencias vulnerables (fase 37).
 *
 * Por qué existe: `npm audit` no corría en ningún sitio. Nadie se enteraba de
 * que entraba una dependencia con un CVE hasta que alguien lo miraba a mano, y
 * nadie lo miraba a mano.
 *
 * Por qué NO falla con `--audit-level=high` a secas: hoy ya hay decenas de
 * avisos en las dependencias de producción. Un candado que nace en rojo se
 * desactiva el primer día. Este compara contra un techo y falla solo si aparece
 * un paquete grave NUEVO.
 *
 * Por qué compara PAQUETES y no contadores (2026-09-05, y esto costó un CI
 * apagado en silencio): el primer intento contaba vulnerabilidades por
 * severidad, y el mismo lockfile daba 14 altas aquí y 15 en el CI. Se
 * diagnosticó como diferencia de sistema operativo y se hizo un techo por
 * plataforma — **falso**: la diferencia es la VERSION DE NPM (npm 11 ve 14,
 * npm 10.8 ve 15), y como las dos máquinas del equipo son Windows, el techo de
 * Linux no se podía sellar desde ninguna. Resultado: el job del CI imprimía
 * «no hay techo sellado para linux» y salía 0 sin comparar nada, durante horas,
 * mientras el informe decía que estaba protegido.
 *
 * El conjunto de paquetes graves sí es estable entre versiones de npm, y
 * `--sellar` ACUMULA en vez de reemplazar, para que el techo cubra lo que ve
 * cada versión sin que nadie tenga que adivinar cuál corre dónde.
 *
 * Mira solo `--omit=dev`: vitest o @nestjs/cli no se despliegan, y mezclarlos
 * con multer o jsonwebtoken esconde lo que sí llega al servidor.
 *
 *   node scripts/arqueo-dependencias.cjs            # resumen
 *   node scripts/arqueo-dependencias.cjs --ci       # falla si aparece uno nuevo
 *   node scripts/arqueo-dependencias.cjs --sellar   # acumula en el techo
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** `--baseline=` y `--auditoria=` existen para poder PROBAR el trinquete sin
 *  red ni `npm audit` real. Ver `backend/test/arqueo-dependencias.test.ts`. */
const argOpcion = (nombre) => {
  const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
  return a ? a.slice(nombre.length + 3) : null;
};
const BASELINE = argOpcion('baseline') || path.join(__dirname, 'dependencias.baseline.json');
const AUDITORIA_FIJA = argOpcion('auditoria');
const PAQUETES = ['backend', 'frontend'];
const GRAVES = ['critical', 'high'];

/**
 * Devuelve la auditoría de un paquete, o `null` si NO se pudo auditar.
 *
 * La distinción es todo el asunto: ante un fallo de red o de registro,
 * `npm audit --json` escribe en stdout un JSON *válido* con `message` y `error`
 * y sin `metadata`. Parsearlo alegremente daba cero vulnerabilidades, el
 * trinquete lo leía como «bajaron todas» y el CI salía en verde. Un audit que
 * falla no es un «sin vulnerabilidades»: es no haber mirado.
 */
function auditar(dir) {
  const cwd = path.join(ROOT, dir);
  if (!fs.existsSync(path.join(cwd, 'package.json'))) return null;
  let salida;
  try {
    // npm audit sale con codigo != 0 cuando ENCUENTRA algo: eso no es un fallo
    // del comando, asi que se captura y se sigue mirando el contenido.
    salida = execSync('npm audit --omit=dev --json', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    salida = e.stdout;
    if (e.stderr) process.stderr.write(String(e.stderr).split('\n').slice(0, 5).join('\n') + '\n');
  }
  if (!salida) return null;
  let datos;
  try {
    datos = JSON.parse(salida);
  } catch {
    return null;
  }
  // Sin `metadata.vulnerabilities` no hay auditoría: es el JSON de error de npm.
  if (!datos || !datos.metadata || !datos.metadata.vulnerabilities) return null;
  const v = datos.metadata.vulnerabilities;
  const graves = Object.entries(datos.vulnerabilities || {})
    .filter(([, x]) => GRAVES.includes(x.severity))
    .map(([nombre, x]) => `${nombre}:${x.severity}`)
    .sort();
  return {
    critical: v.critical || 0,
    high: v.high || 0,
    moderate: v.moderate || 0,
    low: v.low || 0,
    graves,
  };
}

const actual = {};
const fallaron = [];
if (AUDITORIA_FIJA) {
  Object.assign(actual, JSON.parse(fs.readFileSync(AUDITORIA_FIJA, 'utf8')));
} else {
  for (const p of PAQUETES) {
    const r = auditar(p);
    if (r) actual[p] = r;
    else fallaron.push(p);
  }
}

const resumen = (p, r) =>
  `  ${p.padEnd(9)} critical ${r.critical}   high ${r.high}   moderate ${r.moderate}   low ${r.low}   (${r.graves.length} paquetes graves)`;

// ---------------------------------------------------------------------------

if (process.argv.includes('--sellar')) {
  if (fallaron.length) {
    console.error(`\nNo se sella lo que no se ha podido auditar: ${fallaron.join(', ')}\n`);
    process.exit(1);
  }
  const previo = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
  const techo = previo.graves && typeof previo.graves === 'object' ? previo.graves : {};
  let nuevos = 0;
  for (const [p, r] of Object.entries(actual)) {
    const antes = new Set(techo[p] || []);
    for (const g of r.graves) if (!antes.has(g)) nuevos++;
    // ACUMULA: asi el techo cubre lo que ve cada version de npm sin que nadie
    // tenga que saber cual corre en el CI.
    techo[p] = [...new Set([...(techo[p] || []), ...r.graves])].sort();
  }
  fs.writeFileSync(BASELINE, JSON.stringify({ graves: techo }, null, 2) + '\n');
  console.log('\nTecho sellado:\n');
  for (const [p, r] of Object.entries(actual)) console.log(resumen(p, r));
  console.log(`\n  ${nuevos} paquete(s) grave(s) añadido(s) al techo.`);
  console.log(`Escrito en ${path.relative(ROOT, BASELINE).replace(/\\/g, '/')}\n`);
  process.exit(0);
}

if (process.argv.includes('--ci')) {
  if (fallaron.length) {
    console.error('\n=== NO SE PUDO AUDITAR ===\n');
    for (const p of fallaron) console.error(`  ${p}`);
    console.error('\nUn `npm audit` que falla no es un «sin vulnerabilidades»: es no haber');
    console.error('mirado. Revisa la red, el lockfile o el registro antes de seguir.\n');
    process.exit(1);
  }
  if (!fs.existsSync(BASELINE)) {
    console.error('\nNo hay techo sellado. Corre --sellar una vez y commitea el JSON.\n');
    process.exit(1);
  }
  const techo = (JSON.parse(fs.readFileSync(BASELINE, 'utf8')) || {}).graves || {};

  // Si un paquete que esta en el techo hoy no devuelve nada, NO se pasa por
  // alto: seria dejar medio arqueo sin vigilar y el CI en verde.
  const faltan = Object.keys(techo).filter((p) => !actual[p]);
  if (faltan.length) {
    console.error('\n=== NO SE PUDO AUDITAR LO QUE ANTES SI ===\n');
    for (const p of faltan) console.error(`  ${p}   (esta en el techo y hoy no devuelve nada)`);
    console.error('');
    process.exit(1);
  }

  const nuevos = [];
  const desaparecidos = [];
  for (const [p, r] of Object.entries(actual)) {
    const antes = new Set(techo[p] || []);
    const ahora = new Set(r.graves);
    for (const g of r.graves) if (!antes.has(g)) nuevos.push({ p, g });
    for (const g of antes) if (!ahora.has(g)) desaparecidos.push({ p, g });
  }

  if (nuevos.length) {
    console.error('\n=== DEPENDENCIAS: PAQUETE GRAVE NUEVO EN LO QUE SE DESPLIEGA ===\n');
    for (const n of nuevos) console.error(`  ${n.p}   ${n.g}`);
    console.error('\nEsto mira solo dependencias de PRODUCCION (--omit=dev): lo que corre en');
    console.error('el servidor, no las herramientas de desarrollo. Mira que entro:\n');
    console.error('  cd backend && npm audit --omit=dev\n');
    console.error('Si es inevitable por ahora, sella el techo y explica por que en el commit:\n');
    console.error('  node scripts/arqueo-dependencias.cjs --sellar\n');
    process.exit(1);
  }

  if (desaparecidos.length) {
    console.log('\nYa no aparecen (bien). Quedan en el techo porque otra version de npm');
    console.log('puede seguir viendolos; para limpiarlos, edita el JSON a mano:\n');
    for (const d of desaparecidos) console.log(`  ${d.p}   ${d.g}`);
    console.log('');
  }

  const total = Object.values(actual).reduce((n, r) => n + r.graves.length, 0);
  console.log(`Dependencias: sin paquetes graves nuevos (${total} vigilados).`);
  process.exit(0);
}

// ---------------------------------------------------------------------------

if (fallaron.length) {
  console.error(`\nNo se pudo auditar: ${fallaron.join(', ')}\n`);
  process.exit(1);
}
console.log('\n=== DEPENDENCIAS VULNERABLES (solo lo que se despliega) ===\n');
for (const [p, r] of Object.entries(actual)) console.log(resumen(p, r));
for (const [p, r] of Object.entries(actual)) {
  if (!r.graves.length) continue;
  console.log(`\n--- ${p}: criticas y altas ---`);
  for (const g of r.graves) {
    const [nombre, sev] = g.split(':');
    console.log(`  ${sev.padEnd(8)} ${nombre}`);
  }
}
console.log('');
