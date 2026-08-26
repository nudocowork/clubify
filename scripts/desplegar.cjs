#!/usr/bin/env node
/**
 * Despliegue con freno de mano.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Este producto se trabaja desde dos máquinas y las dos despliegan al mismo
 * producción. En un solo día pasaron las dos formas de perder trabajo:
 *
 *   1. Una máquina desplegó el backend con `railway up`, que sube EL
 *      DIRECTORIO LOCAL y no lo que hay en git. Se llevó por delante 192
 *      commits de la otra que estaban en producción. Se vio porque rutas que
 *      daban 401 pasaron a dar 404.
 *
 *   2. El repo vive dentro de OneDrive, que sincroniza el directorio de
 *      trabajo entre las dos máquinas. El trabajo SIN COMMITEAR de una
 *      aparece en la copia de la otra; un `git add -A` se lo lleva dentro de
 *      un commit ajeno, con su mensaje equivocado y, si estaba a medias, sin
 *      compilar.
 *
 * Este script no arregla la causa —para eso hay que sacar el repo de OneDrive—
 * pero impide desplegar en las situaciones en las que se pierde algo.
 *
 * ── Uso ────────────────────────────────────────────────────────────────────
 *
 *   node scripts/desplegar.cjs backend
 *   node scripts/desplegar.cjs frontend
 *   node scripts/desplegar.cjs backend --force   (salta los frenos; que conste)
 */
const { execSync, spawnSync } = require('child_process');

const OBJETIVO = process.argv[2];
const FORZAR = process.argv.includes('--force');

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
}

function morir(titulo, detalle, comoSeArregla) {
  console.error(`\n  ✖ ${titulo}\n`);
  if (detalle) console.error(`${detalle}\n`);
  if (comoSeArregla) console.error(`  Cómo se arregla:\n${comoSeArregla}\n`);
  console.error('  (Si de verdad sabes lo que haces: --force)\n');
  process.exit(1);
}

if (!['backend', 'frontend'].includes(OBJETIVO)) {
  console.error('\n  Uso: node scripts/desplegar.cjs backend|frontend\n');
  process.exit(1);
}

console.log(`\n  Preparando despliegue de ${OBJETIVO.toUpperCase()}…\n`);

// ── 1. Traer lo que haya subido la otra máquina ────────────────────────────
try {
  execSync('git fetch --all --quiet', { stdio: 'ignore' });
} catch {
  console.warn('  ⚠ No se pudo hacer fetch. ¿Hay red? Sigo, pero a ciegas.');
}

const rama = git('rev-parse --abbrev-ref HEAD');

// ── 2. El directorio de trabajo tiene que estar limpio ─────────────────────
//
// Es el freno que faltaba: con OneDrive de por medio, lo que hay sin commitear
// puede no ser tuyo. Y `railway up` lo subiría a producción igual.
const sucio = git('status --porcelain');
if (sucio && !FORZAR) {
  morir(
    'Hay cambios sin commitear.',
    sucio
      .split('\n')
      .slice(0, 20)
      .map((l) => `    ${l}`)
      .join('\n'),
    '    Revisa CADA archivo antes de decidir. Con OneDrive sincronizando,\n' +
      '    puede haber trabajo de la otra máquina aquí metido.\n' +
      '    Commitea lo tuyo por rutas explícitas — NUNCA `git add -A`.',
  );
}

// ── 3. No desplegar por detrás de origin ───────────────────────────────────
//
// Desplegar estando detrás borra de producción lo que la otra máquina subió.
let detras = 0;
let adelante = 0;
try {
  const cuenta = git(`rev-list --left-right --count origin/${rama}...HEAD`);
  [detras, adelante] = cuenta.split(/\s+/).map(Number);
} catch {
  console.warn(`  ⚠ La rama ${rama} no está en origin. Empújala antes.`);
}

if (detras > 0 && !FORZAR) {
  const queFalta = git(`log --oneline HEAD..origin/${rama}`)
    .split('\n')
    .slice(0, 10)
    .map((l) => `    ${l}`)
    .join('\n');
  morir(
    `Te faltan ${detras} commit(s) que ya están en origin.`,
    `${queFalta}\n\n  Desplegar ahora los borraría de producción.`,
    `    git merge origin/${rama}   (y verifica que compila antes de seguir)`,
  );
}

if (adelante > 0 && !FORZAR) {
  morir(
    `Tienes ${adelante} commit(s) sin empujar.`,
    '  Si los despliegas sin subirlos, producción tendrá código que no está\n' +
      '  en ninguna rama. Es como acabamos con código en producción que nadie\n' +
      '  podía encontrar.',
    '    git push origin HEAD',
  );
}

// ── 4. Decir en voz alta qué se va a desplegar ─────────────────────────────
const ultimo = git('log -1 --format=%h %s');
console.log(`  rama:   ${rama}`);
console.log(`  commit: ${ultimo}`);
console.log(`  estado: limpio, sincronizado con origin\n`);

// ── 5. Desplegar ───────────────────────────────────────────────────────────
if (OBJETIVO === 'backend') {
  // Desde la RAÍZ del repo, no desde backend/ — el railway.json de la raíz es
  // el que apunta al Dockerfile correcto.
  console.log('  Subiendo a Railway…\n');
  const r = spawnSync('railway', ['up', '--service', 'backend', '--detach'], {
    stdio: 'inherit',
    shell: true,
  });
  process.exit(r.status ?? 0);
} else {
  // El proyecto de Vercel vive en el equipo de Jhon: sin --scope, el CLI
  // resuelve el equipo equivocado y devuelve "Not authorized".
  console.log('  Subiendo a Vercel…\n');
  const r = spawnSync(
    'npx',
    [
      'vercel',
      'deploy',
      '--prod',
      '--yes',
      '--scope',
      'jhonarias888-1963s-projects',
    ],
    { stdio: 'inherit', shell: true, cwd: 'frontend' },
  );
  process.exit(r.status ?? 0);
}
