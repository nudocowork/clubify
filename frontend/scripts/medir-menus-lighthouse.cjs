/**
 * Mide los menús con Lighthouse en condiciones comparables (auditoría de
 * rendimiento del 2026-10-07). Para repetir la medición DESPUÉS de desplegar y
 * comparar contra la tabla de la auditoría con las mismas condiciones.
 *
 *   mkdir %TEMP%\lh && cd %TEMP%\lh && npm init -y && npm i lighthouse@13.5.0
 *   set LH_DIR=%TEMP%\lh && node frontend/scripts/medir-menus-lighthouse.cjs 3
 *
 * Escribe `resultados.jsonl` en LH_DIR: una línea por corrida (TTFB, FCP, LCP,
 * CLS, TBT, bytes por tipo, errores de consola). La condición «caliente» NO
 * sirve: Lighthouse vuelve a bajar todo aunque se conserve el perfil; la
 * visita repetida se mide en Chrome real (Resource Timing).
 */
// Batería Lighthouse: 6 URLs × 4 condiciones × 3 corridas, en serie (poca RAM).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const DIR = process.env.LH_DIR || __dirname;
const URLS = {
  'konys-d': 'https://soyclubify.com/d/konys',
  'konys-m': 'https://soyclubify.com/m/konys',
  'nudo-d': 'https://soyclubify.com/d/nudocowork',
  'nudo-m': 'https://soyclubify.com/m/nudocowork',
  'cluvi-barrio': 'https://barrio-campestre.cluvi.co/barrio-campestre/menu-digital/home',
  'cluvi-republicano': 'https://el-republicano.cluvi.co/newmenu/22610/on_table/basic',
};
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const COND = {
  // Móvil Lighthouse por defecto: 4G lento simulado (RTT 150 ms, 1,6 Mbps), CPU ×4.
  movil_lento_frio: [],
  // Escritorio: 40 ms RTT, 10 Mbps, CPU ×1.
  escritorio_frio: ['--preset=desktop'],
  // Móvil con la red REAL de esta máquina, sin CPU limitada.
  movil_red_real_frio: ['--throttling-method=provided'],
  
};
const corridas = Number(process.argv[2] || 3);
const salida = path.join(DIR, 'resultados.jsonl');
for (const [cond, extra] of Object.entries(COND)) {
  for (const [nombre, url] of Object.entries(URLS)) {
    const perfil = path.join(DIR, 'perfiles', `${nombre}-${cond}`);
    fs.mkdirSync(perfil, { recursive: true });
    const n = cond.endsWith('caliente') ? corridas + 1 : corridas; // la 1ª calienta
    for (let i = 0; i < n; i++) {
      const out = path.join(DIR, 'json', `${nombre}__${cond}__${i}.json`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const flags = ['--headless=new', '--no-first-run', `--user-data-dir=${perfil}`];
      try {
        execFileSync(
          process.execPath,
          [
            path.join(DIR, 'node_modules/lighthouse/cli/index.js'),
            url,
            '--only-categories=performance',
            '--output=json',
            `--output-path=${out}`,
            `--chrome-path=${CHROME}`,
            `--chrome-flags=${flags.join(' ')}`,
            '--quiet',
            '--max-wait-for-load=60000',
            ...extra,
          ],
          { stdio: 'ignore', timeout: 180000 },
        );
        const r = JSON.parse(fs.readFileSync(out, 'utf8'));
        const a = r.audits;
        const num = (k) => a[k]?.numericValue ?? null;
        const items = (k) => a[k]?.details?.items ?? [];
        const res = Object.fromEntries(items('resource-summary').map((x) => [x.resourceType, { n: x.requestCount, kb: Math.round(x.transferSize / 1024) }]));
        const fila = {
          nombre, cond, i, url,
          error: r.runtimeError?.code ?? null,
          warnings: r.runWarnings ?? [],
          score: r.categories.performance.score,
          ttfb: num('server-response-time'),
          fcp: num('first-contentful-paint'),
          lcp: num('largest-contentful-paint'),
          cls: num('cumulative-layout-shift'),
          tbt: num('total-blocking-time'),
          si: num('speed-index'),
          bootup: num('bootup-time'),
          mainthread: num('mainthread-work-breakdown'),
          longTasks: items('long-tasks').length,
          recursos: res,
          consola: items('errors-in-console').map((x) => String(x.description).slice(0, 160)),
          lcpElem: items('largest-contentful-paint-element')?.[0]?.items?.[0]?.node?.snippet?.slice(0, 160) ?? null,
        };
        fs.appendFileSync(salida, JSON.stringify(fila) + '\n');
        console.log(nombre, cond, i, 'lcp', Math.round(fila.lcp), 'kb', res.total?.kb);
      } catch (e) {
        fs.appendFileSync(salida, JSON.stringify({ nombre, cond, i, url, fallo: String(e.message).slice(0, 200) }) + '\n');
        console.log(nombre, cond, i, 'FALLO');
      }
    }
  }
}
console.log('FIN');
