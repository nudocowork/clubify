#!/usr/bin/env node
/**
 * Pruebas de `pedirConLimite` (las consultas del menú con tiempo límite).
 *
 *   node scripts/pruebas-pedir-con-limite.mjs
 *
 * Lo que se cuida: que una petición COLGADA termine (antes el menú se quedaba
 * cargando para siempre), que un fallo pasajero se reintente solo una vez, y
 * que un 404 —el negocio no existe— llegue tal cual, sin reintentos.
 */
import assert from 'node:assert/strict';
import { pedirConLimite } from '../src/lib/menu/pedir-con-limite.mjs';

let fallos = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    console.log(`  ✓ ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`  ✗ ${nombre}\n    ${e.message}`);
  }
}

/** Un `fetch` falso que responde según el guion, uno por intento. */
function guion(...pasos) {
  const llamadas = { n: 0 };
  const f = (_url, { signal }) => {
    const paso = pasos[Math.min(llamadas.n++, pasos.length - 1)];
    if (paso === 'cuelga') {
      return new Promise((_ok, mal) => {
        signal.addEventListener('abort', () => mal(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }
    if (paso === 'red') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(new Response(JSON.stringify({ paso }), { status: paso }));
  };
  return { f, llamadas };
}
const rapido = { limiteMs: 30, pausaMs: 1 };

await prueba('una respuesta normal llega con su cuerpo', async () => {
  const { f, llamadas } = guion(200);
  const r = await pedirConLimite('/x', { ...rapido, fetch: f });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { paso: 200 });
  assert.equal(llamadas.n, 1);
});

await prueba('colgada y luego bien: se reintenta y el menú carga', async () => {
  const { f, llamadas } = guion('cuelga', 200);
  const r = await pedirConLimite('/x', { ...rapido, fetch: f });
  assert.equal(r.status, 200);
  assert.equal(llamadas.n, 2);
});

await prueba('colgada siempre: TERMINA con SinRed (antes: cargando para siempre)', async () => {
  const { f, llamadas } = guion('cuelga');
  const t0 = Date.now();
  await assert.rejects(pedirConLimite('/x', { ...rapido, fetch: f }), (e) => e.name === 'SinRed');
  assert.equal(llamadas.n, 2);
  assert.ok(Date.now() - t0 < 1000, 'debe rendirse en el tiempo límite, no esperar al navegador');
});

await prueba('error de red pasajero: un reintento', async () => {
  const { f, llamadas } = guion('red', 200);
  const r = await pedirConLimite('/x', { ...rapido, fetch: f });
  assert.equal(r.status, 200);
  assert.equal(llamadas.n, 2);
});

await prueba('un 5xx se reintenta; si persiste, llega el 5xx', async () => {
  const { f, llamadas } = guion(503, 503);
  const r = await pedirConLimite('/x', { ...rapido, fetch: f });
  assert.equal(r.status, 503);
  assert.equal(llamadas.n, 2);
});

await prueba('un 404 (el negocio no existe) NO se reintenta', async () => {
  const { f, llamadas } = guion(404);
  const r = await pedirConLimite('/x', { ...rapido, fetch: f });
  assert.equal(r.status, 404);
  assert.equal(llamadas.n, 1);
});

if (fallos) {
  console.log(`\n${fallos} prueba(s) fallaron`);
  process.exit(1);
}
console.log('\nTodas las pruebas pasan.');
