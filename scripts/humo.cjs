#!/usr/bin/env node
/**
 * Prueba de humo del recorrido del CLIENTE FINAL, en un navegador de verdad y
 * con perfil LIMPIO.
 *
 * Por qué existe
 * ──────────────
 * El 2026-09-05 un negocio nos mandó un informe de 14 páginas con un fallo que
 * dejaba la página en blanco en la PRIMERA visita de cualquier cliente nuevo.
 * Teníamos 51 archivos de pruebas en el backend y ninguno lo vio, porque
 * ninguno abre un navegador: el fallo era un bloqueo mutuo dentro del service
 * worker, y eso solo existe cuando hay un navegador instalando uno.
 *
 * De ahí las dos decisiones de este script:
 *
 *  · PERFIL LIMPIO EN CADA COMPROBACIÓN. Es la condición que se nos escapó. Con
 *    un perfil reutilizado el service worker ya está instalado y el fallo no se
 *    reproduce — que es exactamente por qué nunca lo vimos desde dentro.
 *  · CONTRA PRODUCCIÓN DE VERDAD. Lo que se rompió no se rompía en local.
 *
 * Sin dependencias nuevas: usa el Chrome que ya está instalado. Para el CI
 * habrá que cambiarlo por Playwright, pero para correrlo a mano y después de
 * cada despliegue, esto basta y no añade 300 MB al repo.
 *
 *   node scripts/humo.cjs
 *   node scripts/humo.cjs --base=https://app.soyclubify.com
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE =
  (process.argv.find((a) => a.startsWith('--base=')) || '').split('=')[1] ||
  'https://app.soyclubify.com';

/** Cuánto se le deja a la página para pintar antes de mirar. */
const PRESUPUESTO_MS = 20000;

/**
 * Qué se comprueba.
 *
 * Los marcadores son textos NUESTROS (de la interfaz), nunca datos del negocio:
 * un producto puede desaparecer del menú cualquier martes y eso no es un fallo
 * de la plataforma, pero la prueba se pondría roja igual.
 */
const COMPROBACIONES = [
  {
    nombre: 'Menú de domicilios',
    ruta: '/d/demo-clubify',
    debeTener: ['Mis pedidos'],
    noDebeTener: ['Negocio no disponible'],
  },
  {
    nombre: 'Menú de mesa',
    ruta: '/m/demo-clubify',
    debeTener: ['Hecho con'],
    noDebeTener: ['Negocio no disponible'],
  },
  {
    nombre: 'Login del escáner',
    ruta: '/scan',
    debeTener: ['Iniciar sesión'],
    noDebeTener: [],
  },
];

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => fs.existsSync(p));

function pintarDom(url, perfil) {
  return execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${perfil}`,
      `--virtual-time-budget=${PRESUPUESTO_MS}`,
      '--dump-dom',
      url,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  );
}

(async () => {
  if (!CHROME) {
    console.error('No encuentro Chrome instalado. Instálalo o pasa la ruta.');
    process.exit(2);
  }
  console.log(`Prueba de humo contra ${BASE}\n`);

  let fallos = 0;
  for (const c of COMPROBACIONES) {
    // Perfil NUEVO por comprobación: sin esto la segunda visita ya no reproduce
    // los fallos de primera visita, que son justo los que buscamos.
    const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'humo-'));
    const url = `${BASE}${c.ruta}`;
    const t0 = Date.now();
    let dom = '';
    let error = null;
    try {
      dom = pintarDom(url, perfil);
    } catch (e) {
      error = e.message;
    }
    const ms = Date.now() - t0;

    const faltan = c.debeTener.filter((m) => !dom.includes(m));
    const sobran = c.noDebeTener.filter((m) => dom.includes(m));
    const ok = !error && !faltan.length && !sobran.length;
    if (!ok) fallos++;

    console.log(
      `${ok ? '  ok  ' : ' FALLA'} ${c.nombre.padEnd(22)} ${String(ms).padStart(6)} ms  ${c.ruta}`,
    );
    if (error) console.log(`        el navegador no pudo abrirla: ${error}`);
    if (faltan.length) console.log(`        no apareció: ${faltan.join(', ')}`);
    if (sobran.length) console.log(`        apareció y no debía: ${sobran.join(', ')}`);

    try {
      fs.rmSync(perfil, { recursive: true, force: true });
    } catch {
      /* el perfil queda en temp; no es motivo para fallar la prueba */
    }
  }

  console.log(
    `\n${fallos === 0 ? 'Todo en pie.' : `${fallos} comprobación(es) en rojo.`}`,
  );
  process.exit(fallos === 0 ? 0 : 1);
})();
