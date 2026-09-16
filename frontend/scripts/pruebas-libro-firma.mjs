#!/usr/bin/env node
/**
 * Pruebas de la FIRMA del menú libro (la fuga de marca del pie).
 *
 *   node scripts/pruebas-libro-firma.mjs
 *
 * Lo que se quería: que la carta de un negocio de marca blanca no acabe
 * firmada «Clubify» y enlazando a soyclubify.com delante de sus clientes.
 *
 * La regla del repo es dura y no admite matices: sin marca resuelta NO se
 * pinta nada. Un pie vacío no delata a nadie; uno inventado sí.
 *
 * Ojo con el falso verde: en operación normal el backend SIEMPRE manda un
 * `brand` con nombre (`resolveByWhiteLabelId` cae al WhiteLabel `clubify`),
 * así que probar «el caso normal» no demuestra nada. Lo que hay que probar
 * es el caso degradado — respuesta sin `brand` — que es cuando la fuga
 * salía.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { firmaDelLibro } from '../src/lib/menu/firma-del-libro.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PAGINA = resolve(AQUI, '../src/app/book/[slug]/book-client.tsx');

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

const SELLEA = { name: 'Sellea', websiteUrl: 'https://selleala.com' };

// ══════════════════════════════════════════════════════════════════════════
// 1. LA FUGA: sin marca resuelta no se pinta NADA
// ══════════════════════════════════════════════════════════════════════════
prueba('sin marca no se pinta firma — ni Clubify ni nada', () => {
  igual(firmaDelLibro(undefined), null, 'brand ausente (backend caído)');
  igual(firmaDelLibro(null), null, 'brand nula');
  igual(firmaDelLibro({}), null, 'brand sin nombre');
  igual(firmaDelLibro({ name: null }), null, 'nombre nulo');
  igual(firmaDelLibro({ name: '   ' }), null, 'nombre en blanco');
});

prueba('sin marca TAMPOCO se inventa el destino del enlace', () => {
  // La otra mitad de la fuga: el href caía a soyclubify.com aunque el
  // nombre fuera de otra marca.
  for (const b of [undefined, null, {}, { websiteUrl: 'https://selleala.com' }]) {
    igual(firmaDelLibro(b), null, 'sin nombre no hay firma ni enlace');
  }
});

prueba('nunca aparece Clubify ni soyclubify por respaldo', () => {
  const sospechosos = [undefined, null, {}, { name: '' }, { name: '  ' }];
  for (const b of sospechosos) {
    const f = firmaDelLibro(b);
    const texto = JSON.stringify(f);
    afirmar(!/clubify/i.test(texto), `se coló la plataforma: ${texto}`);
    afirmar(!/soyclubify/i.test(texto), `se coló el dominio: ${texto}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 2. LO QUE NO PUEDE CAMBIAR: la marca que SÍ resuelve se sigue pintando
// ══════════════════════════════════════════════════════════════════════════
prueba('una marca resuelta firma con SU nombre y SU web', () => {
  igual(
    firmaDelLibro(SELLEA),
    { nombre: 'Sellea', enlace: 'https://selleala.com' },
    'Sellea',
  );
});

prueba('Clubify como marca de verdad se sigue firmando', () => {
  // Que no se pinte por RESPALDO no quiere decir que se esconda cuando la
  // marca del negocio es Clubify de verdad.
  igual(
    firmaDelLibro({ name: 'Clubify', websiteUrl: 'https://soyclubify.com' }),
    { nombre: 'Clubify', enlace: 'https://soyclubify.com' },
    'Clubify resuelto',
  );
});

prueba('con nombre pero sin web se pinta el nombre SIN enlace', () => {
  igual(firmaDelLibro({ name: 'Sellea' }), { nombre: 'Sellea', enlace: null }, 'sin web');
  igual(
    firmaDelLibro({ name: 'Sellea', websiteUrl: '   ' }),
    { nombre: 'Sellea', enlace: null },
    'web en blanco',
  );
});

prueba('un enlace que no es una web no se pinta como enlace', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'selleala.com', 'https://']) {
    igual(
      firmaDelLibro({ name: 'Sellea', websiteUrl: url }),
      { nombre: 'Sellea', enlace: null },
      `rechazado: ${url}`,
    );
  }
});

prueba('se recortan los espacios', () => {
  igual(
    firmaDelLibro({ name: '  Sellea  ', websiteUrl: '  https://selleala.com  ' }),
    { nombre: 'Sellea', enlace: 'https://selleala.com' },
    'recorte',
  );
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
const pagina = readFileSync(PAGINA, 'utf8').replace(/\r\n/g, '\n');
const anclas = [
  ["from '@/lib/menu/firma-del-libro.mjs'", true],
  ['firmaDelLibro(s.brand)', true],
  // Las dos mitades de la fuga. Si alguien las devuelve, todo lo de arriba
  // sigue en verde y la carta vuelve a firmar con la plataforma.
  ["|| 'Clubify'", false],
  ["'https://soyclubify.com'", false],
];
const mal = anclas
  .filter(([a, debeEstar]) => pagina.includes(a) !== debeEstar)
  .map(([a, debeEstar]) => `${debeEstar ? 'falta' : 'VOLVIÓ LA FUGA'}: ${a}`);
if (mal.length) {
  fallos++;
  console.log(`\nFALLA  el pie de /book ya no usa lo que se prueba aquí:\n       ${mal.join('\n       ')}`);
} else {
  console.log('\nok     el pie de /book usa la firma probada aquí');
}

console.log(`\n${fallos === 0 ? 'TODO VERDE' : `${fallos} FALLO(S)`} — ${casos.length} casos`);
process.exit(fallos === 0 ? 0 : 1);
