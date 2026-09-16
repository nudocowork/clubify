#!/usr/bin/env node
/**
 * Pruebas del embudo del píxel por sede.
 *
 *   node scripts/pruebas-pixel-por-sede.mjs
 *
 * Lo que se quería: poder ver en Meta que una sede concreta recibe carritos
 * que no se cierran. Para eso la sede tiene que ir en los CUATRO eventos
 * (ViewContent, AddToCart, InitiateCheckout y Purchase), no solo en la compra,
 * y tiene que leerse con su nombre y no como «50bb2564-19a0-467f-…».
 *
 * Lo que estas pruebas cuidan tanto como eso: que un negocio SIN sedes siga
 * mandando exactamente los mismos parámetros que hoy. Añadir una dimensión no
 * puede ensuciar los datos de todos los demás negocios.
 *
 * Quipao Bubble Tea es el caso real: 3 sedes, un solo catálogo, y las sedes se
 * distinguen por el `?sede=` del enlace.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { paramsConSede } from '../src/lib/sede-del-pixel.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PIXEL = resolve(AQUI, '../src/lib/pixel-del-negocio.ts');
const MENU = resolve(AQUI, '../src/app/m/[slug]/storefront-client.tsx');

let fallos = 0;
const casos = [];
const prueba = (nombre, fn) => casos.push([nombre, fn]);
function afirmar(cond, detalle) {
  if (!cond) throw new Error(detalle);
}
const igual = (a, b, detalle) =>
  afirmar(
    JSON.stringify(a) === JSON.stringify(b),
    `${detalle} — esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`,
  );

const MARGARITA = {
  id: '50bb2564-19a0-467f-ac29-d20e1e1b77c0',
  nombre: 'Sambil ︎Margarita',
};
const VER_PRODUCTO = {
  content_type: 'product',
  content_ids: ['p-mocca'],
  content_name: 'Mocca frío',
  value: 20000,
};

// ══════════════════════════════════════════════════════════════════════════
// 1. LO QUE SE PEDÍA
// ══════════════════════════════════════════════════════════════════════════
prueba('la sede se lee con su NOMBRE, no con el id', () => {
  const p = paramsConSede(VER_PRODUCTO, MARGARITA);
  igual(p.content_category, MARGARITA.nombre, 'lo que se lee en Meta');
  igual(p.sede_id, MARGARITA.id, 'la llave estable');
});

prueba('el resto del evento no se toca', () => {
  const p = paramsConSede(VER_PRODUCTO, MARGARITA);
  igual(p.content_ids, ['p-mocca'], 'ids');
  igual(p.value, 20000, 'importe');
  igual(p.content_name, 'Mocca frío', 'nombre del producto');
});

prueba('sirve para cualquier evento del embudo', () => {
  // La misma función la usan los cuatro: si uno se quedara fuera, el embudo
  // por sede no se podría comparar de punta a punta.
  const carrito = paramsConSede({ content_type: 'product' }, MARGARITA);
  const checkout = paramsConSede({ num_items: 3 }, MARGARITA);
  igual(carrito.sede_id, MARGARITA.id, 'AddToCart');
  igual(checkout.sede_id, MARGARITA.id, 'InitiateCheckout');
});

// ══════════════════════════════════════════════════════════════════════════
// 2. LO QUE NO PUEDE CAMBIAR
// ══════════════════════════════════════════════════════════════════════════
prueba('un negocio SIN sedes manda exactamente lo de siempre', () => {
  igual(paramsConSede(VER_PRODUCTO, null), VER_PRODUCTO, 'sin sede');
  igual(paramsConSede(VER_PRODUCTO, undefined), VER_PRODUCTO, 'sede ausente');
  igual(paramsConSede(VER_PRODUCTO, { id: '  ' }), VER_PRODUCTO, 'id vacío');
});

prueba('un content_category ya puesto no se pisa', () => {
  const p = paramsConSede({ content_category: 'Postres' }, MARGARITA);
  igual(p.content_category, 'Postres', 'lo que ya venía manda');
  igual(p.sede_id, MARGARITA.id, 'la sede igual viaja');
});

prueba('una sede sin nombre cae al id, que es lo que se mandaba antes', () => {
  const p = paramsConSede(VER_PRODUCTO, { id: 'abc123' });
  igual(p.content_category, 'abc123', 'respaldo');
});

prueba('no se muta el objeto que recibe', () => {
  const original = { content_type: 'product' };
  paramsConSede(original, MARGARITA);
  igual(original, { content_type: 'product' }, 'el parámetro queda intacto');
});

// ══════════════════════════════════════════════════════════════════════════
// Ejecutar
// ══════════════════════════════════════════════════════════════════════════
for (const [nombre, fn] of casos) {
  try {
    fn();
    console.log(`ok     ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`FALLA  ${nombre}\n       ${e.message}`);
  }
}

// CRLF (Windows + OneDrive) normalizado antes de comparar, o las anclas no
// casan nunca y esto daría un rojo falso.
const pixel = readFileSync(PIXEL, 'utf8').replace(/\r\n/g, '\n');
const menu = readFileSync(MENU, 'utf8').replace(/\r\n/g, '\n');
const anclas = [
  [PIXEL, pixel, "from './sede-del-pixel.mjs'"],
  [PIXEL, pixel, 'paramsConSede(p, sedeDelNegocio)'],
  [PIXEL, pixel, 'export function configurarSedeDelNegocio('],
  // Las DOS llamadas del menú, no una cualquiera: la del enlace `?sede=` cubre
  // «ver producto» y «añadir al carrito», y la del checkout cubre a quien llega
  // por el enlace general y elige sede. Con un ancla genérica, quitar una de
  // las dos dejaba el embudo a medias y esto seguía en verde.
  [MENU, menu, 'configurarSedeDelNegocio(suya.id, suya.name)'],
  [MENU, menu, 'configurarSedeDelNegocio(effectiveSedeId, effectiveSede?.name)'],
];
const faltan = anclas.filter(([, src, a]) => !src.includes(a)).map(([f, , a]) => `${a}  (${f.split(/[\\/]/).pop()})`);
if (faltan.length) {
  fallos++;
  console.log(`\nFALLA  el píxel ya no usa lo que se prueba aquí:\n       ${faltan.join('\n       ')}`);
} else {
  console.log('\nok     el píxel usa la lógica probada aquí');
}

console.log(`\n${fallos === 0 ? 'TODO VERDE' : `${fallos} FALLO(S)`} — ${casos.length} casos`);
process.exit(fallos === 0 ? 0 : 1);
