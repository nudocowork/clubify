#!/usr/bin/env node
/**
 * Arqueo de dependencias vulnerables (fase 37).
 *
 * Por qué existe: `npm audit` no corría en ningún sitio. Nadie se enteraba de
 * que entraba una dependencia con un CVE hasta que alguien lo miraba a mano, y
 * nadie lo miraba a mano.
 *
 * Por qué NO falla con `--audit-level=high` a secas: hoy ya hay 40 avisos en las
 * dependencias de producción del backend. Un candado que nace en rojo se
 * desactiva el primer día. Este cuenta por severidad y falla solo si SUBE, con
 * lo que el número solo puede bajar.
 *
 * Mira solo `--omit=dev`: vitest o @nestjs/cli no se despliegan, y mezclarlos
 * con multer o jsonwebtoken esconde lo que sí llega al servidor.
 *
 *   node scripts/arqueo-dependencias.cjs            # resumen
 *   node scripts/arqueo-dependencias.cjs --ci       # falla si sube
 *   node scripts/arqueo-dependencias.cjs --sellar   # tras revisar a mano
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(__dirname, 'dependencias.baseline.json');
const PAQUETES = ['backend', 'frontend'];
const GRAVES = ['critical', 'high'];

function auditar(dir) {
  const cwd = path.join(ROOT, dir);
  if (!fs.existsSync(path.join(cwd, 'package.json'))) return null;
  let salida;
  try {
    // npm audit sale con código != 0 cuando encuentra algo: eso NO es un fallo
    // del comando, así que se captura y se sigue.
    salida = execSync('npm audit --omit=dev --json', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    salida = e.stdout;
  }
  if (!salida) return null;
  let datos;
  try {
    datos = JSON.parse(salida);
  } catch {
    return null;
  }
  const v = datos.metadata?.vulnerabilities || {};
  const graves = Object.entries(datos.vulnerabilities || {})
    .filter(([, x]) => GRAVES.includes(x.severity))
    .map(([nombre, x]) => ({ nombre, severidad: x.severity }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  return {
    critical: v.critical || 0,
    high: v.high || 0,
    moderate: v.moderate || 0,
    low: v.low || 0,
    graves,
  };
}

const actual = {};
for (const p of PAQUETES) {
  const r = auditar(p);
  if (r) actual[p] = r;
}

if (!Object.keys(actual).length) {
  console.error('\nNo se pudo auditar ningún paquete. ¿Falta `npm ci`?\n');
  process.exit(1);
}

const resumen = (p, r) =>
  `  ${p.padEnd(9)} critical ${r.critical}   high ${r.high}   moderate ${r.moderate}   low ${r.low}`;

if (process.argv.includes('--sellar')) {
  const techo = {};
  for (const [p, r] of Object.entries(actual)) {
    techo[p] = { critical: r.critical, high: r.high, moderate: r.moderate, low: r.low };
  }
  fs.writeFileSync(BASELINE, JSON.stringify(techo, null, 2) + '\n');
  console.log('\nTecho sellado:\n');
  for (const [p, r] of Object.entries(actual)) console.log(resumen(p, r));
  console.log(`\nEscrito en ${path.relative(ROOT, BASELINE).replace(/\\/g, '/')}\n`);
  process.exit(0);
}

if (process.argv.includes('--ci')) {
  if (!fs.existsSync(BASELINE)) {
    console.error('\nNo hay techo sellado. Corre --sellar una vez y commitea el JSON.\n');
    process.exit(1);
  }
  const techo = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const subieron = [];
  const avisos = [];
  const bajaron = [];
  for (const [p, r] of Object.entries(actual)) {
    const t = techo[p] || { critical: 0, high: 0, moderate: 0, low: 0 };
    for (const sev of ['critical', 'high', 'moderate', 'low']) {
      const antes = t[sev] || 0;
      if (r[sev] > antes) {
        // Solo las graves tumban el CI. Un CVE nuevo de nivel moderate en una
        // dependencia de tercero no puede dejar sin mergear el arreglo urgente
        // de otro: se avisa y se sigue. Un candado que estorba se quita.
        (GRAVES.includes(sev) ? subieron : avisos).push({ p, sev, antes, ahora: r[sev] });
      } else if (r[sev] < antes) {
        bajaron.push({ p, sev, antes, ahora: r[sev] });
      }
    }
  }

  if (avisos.length) {
    console.log('\nSubieron, pero no son graves (no bloquean):\n');
    for (const a of avisos) console.log(`  ${a.p}  ${a.sev}: ${a.antes} -> ${a.ahora}`);
    console.log('');
  }

  if (subieron.length) {
    console.error('\n=== DEPENDENCIAS: hay vulnerabilidades nuevas en lo que se despliega ===\n');
    for (const s of subieron) console.error(`  ${s.p}  ${s.sev}: ${s.antes} -> ${s.ahora}`);
    console.error('\nEsto mira solo dependencias de PRODUCCION (--omit=dev): lo que corre en el');
    console.error('servidor, no las herramientas de desarrollo. Mira qué entró:\n');
    console.error('  cd backend && npm audit --omit=dev\n');
    console.error('Si es inevitable por ahora, sella el techo y explica por qué en el commit:\n');
    console.error('  node scripts/arqueo-dependencias.cjs --sellar\n');
    process.exit(1);
  }

  if (bajaron.length) {
    console.log('\nBajaron (bien). Sella para que no puedan volver a subir:\n');
    for (const b of bajaron) console.log(`  ${b.p}  ${b.sev}: ${b.antes} -> ${b.ahora}`);
    console.log('\n  node scripts/arqueo-dependencias.cjs --sellar\n');
  }

  console.log('Dependencias: sin vulnerabilidades nuevas en lo que se despliega.');
  process.exit(0);
}

console.log('\n=== DEPENDENCIAS VULNERABLES (solo lo que se despliega) ===\n');
for (const [p, r] of Object.entries(actual)) console.log(resumen(p, r));
for (const [p, r] of Object.entries(actual)) {
  if (!r.graves.length) continue;
  console.log(`\n--- ${p}: críticas y altas ---`);
  for (const g of r.graves) console.log(`  ${g.severidad.padEnd(8)} ${g.nombre}`);
}
console.log('');
