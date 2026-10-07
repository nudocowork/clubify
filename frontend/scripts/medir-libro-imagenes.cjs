#!/usr/bin/env node
/**
 * Mide cuánto tarda en verse el menú libro (`/book/<slug>/<sección>`) y qué
 * imágenes se baja, con un Chrome real por CDP.
 *
 * POR QUÉ EXISTE
 *
 * «Las imágenes tardan mucho en aparecer» (De Godoy, 2026-10-07). Contar
 * `<img>` en el DOM no dice nada: lo que cuesta es lo que de verdad viaja por
 * la red. Este script cuenta solicitudes y BYTES TRANSFERIDOS (CDP
 * `Network.loadingFinished.encodedDataLength`) y mide el tiempo hasta que la
 * página que el cliente mira está completa Y decodificada (`img.decode()`),
 * que es cuando se puede leer.
 *
 * Escenarios, en orden, en la misma pestaña:
 *   apertura   → entrar al enlace de la sección (caché vacía o con caché)
 *   siguiente  → flecha «Siguiente»
 *   anterior   → flecha «Anterior»
 *   salto      → miniatura de una página lejana (por defecto la 81)
 *   seccion    → chip de la última sección
 *   zoom       → la lupa (imagen grande de la página actual)
 * Entre escenarios se espera a que la red quede quieta (1,5 s sin
 * solicitudes, máx. 45 s) para que lo que queda bajando de uno no se cuente
 * en el siguiente.
 *
 * Condiciones (`--cond`):
 *   movil        412×823, DPR 2,625, táctil; red 150 ms RTT, 1,6 Mbps bajada,
 *                750 kbps subida; CPU ×4; contexto nuevo (caché vacía)
 *   movil-cache  igual, pero se abre una vez para llenar la caché y se mide
 *                la SEGUNDA visita en el mismo contexto
 *   escritorio   1366×768, DPR 1, sin límites; caché vacía
 *
 * Uso:
 *   PUPPETEER_CORE=<ruta a node_modules/puppeteer-core> \
 *   node scripts/medir-libro-imagenes.cjs --base https://soyclubify.com \
 *     --cond movil --runs 3 --out medicion.json [--capturas dir] [--calentar]
 *
 * `--calentar` hace una corrida previa que se descarta: con `next dev` la
 * primera visita compila la ruta, y esa demora no es del sitio.
 *
 * Solo hace GET a páginas públicas. No inicia sesión ni escribe nada.
 */

const fs = require('node:fs');
const path = require('node:path');

const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');

function arg(nombre, def) {
  const i = process.argv.indexOf(`--${nombre}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const BASE = String(arg('base', 'https://soyclubify.com')).replace(/\/$/, '');
const RUTA = String(arg('ruta', '/book/degodoy-sas/menu-platos-fuertes'));
const COND = String(arg('cond', 'movil'));
const RUNS = Number(arg('runs', 3));
const OUT = arg('out', null);
const CAPTURAS = arg('capturas', null);
const CALENTAR = !!arg('calentar', false);
const SALTO = Number(arg('salto', 81)); // número de página (1-based)
const CHROME = String(arg('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'));

const CONDICIONES = {
  movil: {
    viewport: { width: 412, height: 823, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
    red: { offline: false, latency: 150, downloadThroughput: (1.6e6) / 8, uploadThroughput: (750e3) / 8 },
    cpu: 4,
    cache: false,
  },
  'movil-cache': {
    viewport: { width: 412, height: 823, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
    red: { offline: false, latency: 150, downloadThroughput: (1.6e6) / 8, uploadThroughput: (750e3) / 8 },
    cpu: 4,
    cache: true,
  },
  escritorio: {
    viewport: { width: 1366, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    red: null,
    cpu: 1,
    cache: false,
  },
};
const UA_MOVIL =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

// ── Contabilidad de red por CDP ──────────────────────────────────────
function contador(cdp) {
  const reqs = new Map();
  let ventana = [];
  let enVuelo = 0;
  let ultimoMovimiento = Date.now();
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.startsWith('data:')) return;
    const r = { id: e.requestId, url: e.request.url, tipo: e.type, bytes: 0, fin: false, status: 0, cache: null, desdeCache: false };
    reqs.set(e.requestId, r);
    ventana.push(r);
    enVuelo++;
    ultimoMovimiento = Date.now();
  });
  cdp.on('Network.responseReceived', (e) => {
    const r = reqs.get(e.requestId);
    if (!r) return;
    r.status = e.response.status;
    r.cache = e.response.headers['x-vercel-cache'] || e.response.headers['X-Vercel-Cache'] || null;
    r.desdeCache = !!(e.response.fromDiskCache || e.response.fromServiceWorker || e.response.fromPrefetchCache);
  });
  // Bytes que van llegando (no solo los de solicitudes terminadas): con 100
  // descargas en paralelo casi ninguna termina antes que la página, y contar
  // solo las terminadas escondería justo la competencia que se quiere ver.
  cdp.on('Network.dataReceived', (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.recibidos = (r.recibidos || 0) + (e.encodedDataLength || 0);
  });
  cdp.on('Network.requestServedFromCache', (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.desdeCache = true;
  });
  const cerrar = (e, fallo) => {
    const r = reqs.get(e.requestId);
    if (!r || r.fin) return;
    r.fin = true;
    r.fallo = fallo;
    if (!fallo) r.bytes = e.encodedDataLength || 0;
    enVuelo = Math.max(0, enVuelo - 1);
    ultimoMovimiento = Date.now();
  };
  cdp.on('Network.loadingFinished', (e) => cerrar(e, false));
  cdp.on('Network.loadingFailed', (e) => cerrar(e, true));
  return {
    reiniciar() {
      ventana = [];
    },
    ventana: () => ventana.slice(),
    async quieta(msQuieta = 1500, max = 45000) {
      const t0 = Date.now();
      while (Date.now() - t0 < max) {
        if (enVuelo === 0 && Date.now() - ultimoMovimiento > msQuieta) return Date.now() - t0;
        await new Promise((r) => setTimeout(r, 200));
      }
      return -1;
    },
  };
}

/** Clasifica cada solicitud de imagen con lo que hay en el DOM. */
async function clasificar(page, reqs) {
  const mapa = await page.evaluate(() => {
    const abs = (u) => (u ? new URL(u, location.href).href : null);
    const out = { miniaturas: {}, hojas: {}, lupa: [] };
    const tira = document.querySelector('[data-tira-miniaturas]') ||
      [...document.querySelectorAll('button[aria-label^="Ir a la página"]')][0]?.parentElement;
    const rt = tira?.getBoundingClientRect();
    document.querySelectorAll('button[aria-label^="Ir a la página"] img').forEach((img, i) => {
      const u = abs(img.getAttribute('src') || img.dataset.src);
      const r = img.closest('button').getBoundingClientRect();
      const visible = !!rt && r.right > rt.left && r.left < rt.right;
      if (u) out.miniaturas[u] = { i, visible };
    });
    document.querySelectorAll('img[alt^="Página "]').forEach((img) => {
      const cands = [img.getAttribute('src'), img.currentSrc, img.dataset.src]
        .concat((img.getAttribute('srcset') || '').split(',').map((s) => s.trim().split(' ')[0]));
      for (const c of cands) if (c) out.hojas[abs(c)] = img.alt;
    });
    document.querySelectorAll('[role="dialog"] img').forEach((img) => {
      out.lupa.push(abs(img.currentSrc || img.src));
    });
    return out;
  });
  const res = { recibidosImagenes: 0, imagenes: 0, bytesImagenes: 0, paginas: 0, bytesPaginas: 0, miniaturas: 0, bytesMiniaturas: 0, miniaturasFuera: 0, otras: 0, bytesTotal: 0, solicitudes: reqs.length, fallos: 0, anchos: {} };
  for (const r of reqs) {
    res.bytesTotal += r.bytes;
    if (r.fallo || r.status >= 400) res.fallos++;
    const esImg = r.tipo === 'Image' || r.url.includes('/_next/image');
    if (!esImg) continue;
    res.imagenes++;
    res.bytesImagenes += r.bytes;
    res.recibidosImagenes += r.fin ? r.bytes : r.recibidos || 0;
    const w = (r.url.match(/[?&]w=(\d+)/) || [])[1] || 'crudo';
    res.anchos[w] = (res.anchos[w] || 0) + 1;
    if (mapa.miniaturas[r.url]) {
      res.miniaturas++;
      res.bytesMiniaturas += r.bytes;
      if (!mapa.miniaturas[r.url].visible) res.miniaturasFuera++;
    } else if (mapa.hojas[r.url]) {
      res.paginas++;
      res.bytesPaginas += r.bytes;
    } else res.otras++;
  }
  return res;
}

/** Número (1-based) de la página que marca el contador del pie. */
async function paginaActual(page) {
  return page.evaluate(() => {
    const s = document.querySelector('span.text-ink.font-semibold');
    return s ? Number(s.textContent) : 0;
  });
}

/**
 * Espera a que las hojas visibles del pliego actual estén completas y
 * decodificadas. Devuelve el `performance.now()` de la página en ese momento.
 */
async function esperarLegible(page, numero, doble, max = 90000) {
  const alts = [numero];
  // En doble página (escritorio) el pliego es [impar, par]: la portada va sola.
  if (doble && numero > 1) alts.push(numero % 2 === 0 ? numero + 1 : numero - 1);
  await page.waitForFunction(
    (alts) =>
      alts.every((n) => {
        const img = document.querySelector(`img[alt="Página ${n}"]`);
        if (!img) return n !== alts[0]; // la otra mitad puede no existir (última)
        return img.complete && img.naturalWidth > 0;
      }),
    { polling: 'raf', timeout: max },
    alts,
  );
  return page.evaluate(async (alts) => {
    await Promise.all(
      alts.map((n) => document.querySelector(`img[alt="Página ${n}"]`)?.decode().catch(() => {})),
    );
    return performance.now();
  }, alts);
}

async function escenarioNavegacion(page, red, nombre, accion, doble) {
  const antes = await paginaActual(page);
  red.reiniciar();
  const t0 = await page.evaluate(accion);
  await page.waitForFunction((a) => {
    const s = document.querySelector('span.text-ink.font-semibold');
    return s && Number(s.textContent) !== a;
  }, { polling: 'raf', timeout: 30000 }, antes);
  const numero = await paginaActual(page);
  const t1 = await esperarLegible(page, numero, doble);
  const ms = Math.round(t1 - t0);
  await red.quieta();
  const cuenta = await clasificar(page, red.ventana());
  return { escenario: nombre, pagina: numero, ms, ...cuenta };
}

async function corrida(browser, cond, indice, capturas) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errores = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => errores.push(String(e.message || e).slice(0, 200)));
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  await page.setViewport(cond.viewport);
  if (cond.viewport.isMobile) await page.setUserAgent(UA_MOVIL);
  if (cond.red) await cdp.send('Network.emulateNetworkConditions', cond.red);
  if (cond.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cond.cpu });
  const red = contador(cdp);
  const doble = cond.viewport.width >= 720;
  const url = BASE + RUTA;

  if (cond.cache) {
    // Primera visita: llena la caché. No se mide.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await esperarLegible(page, 1, false, 120000).catch(() => {});
    await red.quieta(1500, 60000);
    await page.goto('about:blank');
  }

  const resultados = [];
  red.reiniciar();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const numero = 1;
  const tLegible = await esperarLegible(page, numero, false, 120000);
  const tiempos = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const api = performance.getEntriesByType('resource').filter((r) => r.name.includes('/api/public/'));
    return {
      ttfb: Math.round(nav?.responseStart || 0),
      api: api.map((r) => ({ u: r.name.split('/api/public/')[1], ini: Math.round(r.startTime), fin: Math.round(r.responseEnd) })),
    };
  });
  // Bytes hasta que la página es legible (lo que compitió con ella).
  const hastaLegible = await clasificar(page, red.ventana());
  const quieta = await red.quieta();
  const cuenta = await clasificar(page, red.ventana());
  resultados.push({
    escenario: 'apertura',
    pagina: numero,
    ms: Math.round(tLegible),
    ...cuenta,
    hastaLegible: { imagenes: hastaLegible.imagenes, bytesImagenes: hastaLegible.recibidosImagenes, miniaturas: hastaLegible.miniaturas },
    redQuietaTras: quieta,
    tiempos,
  });
  if (capturas) await page.screenshot({ path: path.join(capturas, `${COND}-${indice}-1-apertura.png`) });

  const clicBoton = (titulo) => new Function(`
    const b = document.querySelector('button[title="${titulo}"]');
    const t = performance.now(); b.click(); return t;`);
  resultados.push(await escenarioNavegacion(page, red, 'siguiente', clicBoton('Siguiente'), doble));
  // La animación de la hoja dura 600 ms: se deja terminar antes de capturar.
  await new Promise((r) => setTimeout(r, 900));
  if (capturas) await page.screenshot({ path: path.join(capturas, `${COND}-${indice}-2-siguiente.png`) });
  resultados.push(await escenarioNavegacion(page, red, 'anterior', clicBoton('Anterior'), doble));
  await new Promise((r) => setTimeout(r, 900));
  resultados.push(
    await escenarioNavegacion(
      page,
      red,
      'salto',
      new Function(`
        const b = document.querySelector('button[aria-label="Ir a la página ${SALTO}"]');
        const t = performance.now(); b.click(); return t;`),
      doble,
    ),
  );
  await new Promise((r) => setTimeout(r, 900));
  if (capturas) await page.screenshot({ path: path.join(capturas, `${COND}-${indice}-3-salto.png`) });
  resultados.push(
    await escenarioNavegacion(
      page,
      red,
      'seccion',
      () => {
        const chips = [...document.querySelectorAll('button.rounded-full.whitespace-nowrap')];
        const b = chips[chips.length - 1];
        const t = performance.now();
        b.click();
        return t;
      },
      doble,
    ),
  );
  await new Promise((r) => setTimeout(r, 900));
  if (capturas) await page.screenshot({ path: path.join(capturas, `${COND}-${indice}-4-seccion.png`) });

  // Zoom: la lupa. Legible = su imagen completa y decodificada.
  red.reiniciar();
  const t0 = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Ampliar la página"]');
    const t = performance.now();
    b.click();
    return t;
  });
  await page.waitForFunction(() => {
    const img = document.querySelector('[role="dialog"] img');
    return img && img.complete && img.naturalWidth > 0;
  }, { polling: 'raf', timeout: 90000 });
  const t1 = await page.evaluate(async () => {
    await document.querySelector('[role="dialog"] img').decode().catch(() => {});
    return performance.now();
  });
  await red.quieta();
  const cz = await clasificar(page, red.ventana());
  const anchoLupa = await page.evaluate(() => document.querySelector('[role="dialog"] img')?.naturalWidth);
  resultados.push({ escenario: 'zoom', ms: Math.round(t1 - t0), anchoNatural: anchoLupa, ...cz });
  if (capturas) {
    // Ampliar con el botón «+» dos veces para ver la letra pequeña.
    await page.evaluate(() => {
      const b = document.querySelector('button[aria-label="Acercar"]');
      b.click();
      b.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(capturas, `${COND}-${indice}-5-zoom.png`) });
  }

  // Estado final de las hojas: cuántas tienen imagen asignada y cuántas fallaron.
  const finales = await page.evaluate(() => {
    const hojas = [...document.querySelectorAll('img[alt^="Página "]')];
    return {
      hojas: hojas.length,
      conSrc: hojas.filter((i) => i.getAttribute('src')).length,
      rotas: hojas.filter((i) => i.getAttribute('src') && i.complete && i.naturalWidth === 0).length,
      miniaturasConSrc: document.querySelectorAll('button[aria-label^="Ir a la página"] img[src]').length,
    };
  });
  await ctx.close();
  return { corrida: indice, resultados, finales, errores };
}

function mediana(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

(async () => {
  const cond = CONDICIONES[COND];
  if (!cond) throw new Error(`--cond desconocida: ${COND}`);
  if (CAPTURAS) fs.mkdirSync(CAPTURAS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio'],
  });
  const corridas = [];
  try {
    if (CALENTAR) {
      process.stderr.write('calentando (se descarta)…\n');
      await corrida(browser, CONDICIONES.escritorio, 0, null).catch((e) => process.stderr.write(`calentar: ${e.message}\n`));
    }
    for (let i = 1; i <= RUNS; i++) {
      process.stderr.write(`corrida ${i}/${RUNS} ${COND} ${BASE}\n`);
      corridas.push(await corrida(browser, cond, i, i === 1 ? CAPTURAS : null));
    }
  } finally {
    await browser.close();
  }
  // Resumen: mediana [mín–máx] por escenario.
  const resumen = {};
  for (const c of corridas) {
    for (const r of c.resultados) {
      const s = (resumen[r.escenario] ??= { ms: [], imagenes: [], kb: [], miniaturas: [], miniaturasFuera: [], kbHastaLegible: [] });
      s.ms.push(r.ms);
      s.imagenes.push(r.imagenes);
      s.kb.push(Math.round(r.bytesImagenes / 1024));
      s.miniaturas.push(r.miniaturas);
      s.miniaturasFuera.push(r.miniaturasFuera);
      if (r.hastaLegible) s.kbHastaLegible.push(Math.round(r.hastaLegible.bytesImagenes / 1024));
    }
  }
  const fmt = (a) => (a.length ? `${mediana(a)} [${Math.min(...a)}–${Math.max(...a)}]` : '—');
  console.log(`\n${BASE}${RUTA} · ${COND} · ${RUNS} corridas`);
  for (const [e, s] of Object.entries(resumen)) {
    console.log(
      `${e.padEnd(10)} ms ${fmt(s.ms).padEnd(22)} imgs ${fmt(s.imagenes).padEnd(14)} KB ${fmt(s.kb).padEnd(20)} mini ${fmt(s.miniaturas).padEnd(12)} fuera ${fmt(s.miniaturasFuera)}` +
        (s.kbHastaLegible.length ? `  KB-hasta-legible ${fmt(s.kbHastaLegible)}` : ''),
    );
  }
  console.log('errores de consola:', corridas.map((c) => c.errores.length).join(', '));
  console.log('finales:', JSON.stringify(corridas.map((c) => c.finales)));
  if (OUT) fs.writeFileSync(String(OUT), JSON.stringify({ base: BASE, ruta: RUTA, cond: COND, corridas }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
