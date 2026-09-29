#!/usr/bin/env node
/**
 * ¿Cuánto cuesta cada consulta a la base, y cuánto se ahorraría por la red
 * interna de Railway?
 *
 * Existe porque el backend va a Postgres y Redis por el **proxy público**
 * (`tramway.proxy.rlwy.net`), y eso son ~140 ms por consulta en vez de los 1-3
 * que cuesta la red interna. Medido el 2026-09-28 contra producción con
 * `/api/health/ready`: un `SELECT 1` tardaba 141 ms.
 *
 * Con 2.723 consultas repartidas por el backend, eso no es un detalle: crear un
 * pedido (`orders.createPublic`, 14 consultas) son ~2 s de puro ir y venir.
 *
 * DÓNDE CORRERLO:
 *
 *   - Desde tu máquina:        node scripts/medir-latencia-base.cjs
 *     Mide el proxy público. Los `.railway.internal` NO resuelven desde fuera
 *     (es lo esperado, no un fallo): ese nombre solo existe dentro del proyecto.
 *
 *   - Dentro del contenedor:   railway ssh --service backend node scripts/...
 *     Mide los dos y dice el ahorro de verdad. Necesita una clave SSH
 *     registrada (`railway ssh keys add`).
 *
 *   - Después del cambio, para confirmar que sirvió:
 *       curl -s https://api.soyclubify.com/api/health/ready
 *     Si `postgres.latencyMs` sigue en tres cifras, el cambio no entró.
 *
 * EL CAMBIO (verificado el 2026-09-28: el puerto público de Postgres-Nq8w,
 * 39155, es exactamente el que el backend tenía puesto, así que es ESE y no el
 * otro servicio llamado `Postgres`):
 *
 *   DATABASE_URL = ${{Postgres-Nq8w.DATABASE_URL}}    -> yyy.railway.internal:5432
 *   REDIS_URL    = ${{Redis.REDIS_URL}}               -> redis.railway.internal:6379
 */
const net = require('net');

const TOMAS = 6;

// Qué hay que comparar. Los internos solo resuelven dentro del proyecto.
const DESTINOS = [
  { nombre: 'Postgres · red interna', host: 'yyy.railway.internal', port: 5432, interno: true },
  { nombre: 'Postgres · proxy público', host: 'tramway.proxy.rlwy.net', port: 39155, interno: false },
  { nombre: 'Redis · red interna', host: 'redis.railway.internal', port: 6379, interno: true },
  { nombre: 'Redis · proxy público', host: 'tramway.proxy.rlwy.net', port: 54113, interno: false },
];

// Lo que paga cada pantalla, contado sobre el código (`prisma.` por método).
const CAMINOS_CALIENTES = [
  ['crear un pedido', 'orders/orders.service.ts:559 createPublic()', 14],
  ['alta en la tarjeta', 'passes/passes.service.ts:550 enrollPublic()', 11],
  ['alta de prueba', 'auth/auth.service.ts:2076 trialSignup()', 12],
  ['duplicar un negocio', 'admin/tenant-duplicator.service.ts:68 duplicate()', 47],
];

/** Una conexión TCP: abre, mide, cierra. No lee ni escribe nada. */
function unaToma(host, port) {
  return new Promise((res) => {
    const t0 = Date.now();
    const s = net.connect(port, host, () => {
      s.destroy();
      res({ ms: Date.now() - t0 });
    });
    s.on('error', (e) => res({ error: e.code || String(e) }));
    s.setTimeout(6000, () => {
      s.destroy();
      res({ error: 'timeout' });
    });
  });
}

async function medir(d) {
  const tomas = [];
  for (let i = 0; i < TOMAS; i++) tomas.push(await unaToma(d.host, d.port));
  const ms = tomas.filter((t) => typeof t.ms === 'number').map((t) => t.ms);
  // La primera toma suele llevar el coste de resolver el DNS: se descarta.
  const utiles = ms.length > 1 ? ms.slice(1) : ms;
  return {
    ...d,
    media: utiles.length ? Math.round(utiles.reduce((a, b) => a + b, 0) / utiles.length) : null,
    error: ms.length === 0 ? tomas[0].error : null,
    tomas: ms,
  };
}

(async () => {
  console.log('\nLatencia de conexión, ' + TOMAS + ' tomas por destino (se descarta la primera):\n');
  const res = [];
  for (const d of DESTINOS) {
    const r = await medir(d);
    res.push(r);
    const val =
      r.media !== null
        ? String(r.media).padStart(4) + ' ms   [' + r.tomas.join(', ') + ']'
        : 'no se pudo: ' + r.error + (d.interno ? '  (normal fuera del contenedor)' : '');
    console.log('  ' + r.nombre.padEnd(26) + val);
  }

  const pg = {
    interno: res.find((r) => r.nombre.startsWith('Postgres') && r.interno),
    publico: res.find((r) => r.nombre.startsWith('Postgres') && !r.interno),
  };

  if (pg.interno?.media == null || pg.publico?.media == null) {
    console.log(
      '\nNo se pudieron comparar los dos caminos desde aquí. Para el número real\n' +
        'hay que medir DENTRO del contenedor (ver la cabecera de este script).\n' +
        'El dato que sí está confirmado en producción: `SELECT 1` = 141 ms por el\n' +
        'proxy público, medido con /api/health/ready el 2026-09-28.\n',
    );
    // Sin las dos mitades no hay comparación: no se inventa un ahorro.
    process.exit(0);
  }

  const ahorro = pg.publico.media - pg.interno.media;
  console.log(
    '\nPostgres: ' + pg.publico.media + ' ms por el proxy vs ' + pg.interno.media +
      ' ms por dentro  ->  ' + ahorro + ' ms menos por consulta\n',
  );
  console.log('Lo que eso significa por camino:\n');
  for (const [que, donde, n] of CAMINOS_CALIENTES) {
    const antes = n * pg.publico.media;
    const despues = n * pg.interno.media;
    console.log(
      '  ' + que.padEnd(22) + String(n).padStart(2) + ' consultas   ' +
        (antes / 1000).toFixed(2) + ' s  ->  ' + (despues / 1000).toFixed(2) + ' s',
    );
    console.log('  ' + ' '.repeat(22) + donde);
  }
  console.log('');
})();
