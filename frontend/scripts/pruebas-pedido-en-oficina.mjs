#!/usr/bin/env node
/**
 * Pruebas de «un pedido de oficina no tiene repartidor».
 *
 *   node scripts/pruebas-pedido-en-oficina.mjs
 *
 * El caso: el pedido #YD6J7P de Nudo Cowork, hecho desde el menú de «Sala de
 * Juntas», enseñaba en la pantalla del cliente el SEGUIMIENTO DEL DOMICILIO
 * con sus cinco pasos, la empresa DOMIRED y el CHAT DEL DOMICILIO. En una
 * oficina no hay repartidor: se entrega dentro del coworking.
 *
 * Lo que estas pruebas cuidan tanto como el arreglo es **lo que no debe
 * cambiar**: un domicilio normal sigue viendo su seguimiento, y el chat sigue
 * necesitando empresa asignada (eso se arregló en su día porque salía en
 * negocios que ni usan domicilios).
 *
 * Se importa la lógica de verdad, la misma que corre en el navegador, y al
 * final se comprueba que la pantalla la usa: si alguien vuelve a meter la
 * condición a mano en el .tsx, esto se pone en rojo en vez de seguir dando
 * verde sobre código que ya no se ejecuta.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  esPedidoEnOficina,
  hayChatDelDomicilio,
  hayRepartidor,
} from '../src/lib/pedido-en-oficina.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PANTALLA = resolve(AQUI, '../src/app/o/[code]/page.tsx');

let fallos = 0;
const casos = [];
const prueba = (nombre, fn) => casos.push([nombre, fn]);
function afirmar(cond, detalle) {
  if (!cond) throw new Error(detalle);
}

/** El seguimiento que Nudo Cowork tenía creado, con DOMIRED asignada. */
const SEGUIMIENTO = {
  status: 'WAITING_COURIER',
  deliveryCompany: { name: 'DOMIRED', whatsapp: null },
};

const EN_LA_OFICINA = {
  code: 'YD6J7P',
  status: 'PENDING',
  enOficina: true,
  delivery: SEGUIMIENTO,
};
const DOMICILIO_NORMAL = {
  code: 'ABC123',
  status: 'PENDING',
  enOficina: false,
  delivery: SEGUIMIENTO,
};

// ══════════════════════════════════════════════════════════════════════════
// 1. EL BUG
// ══════════════════════════════════════════════════════════════════════════
prueba('oficina · no se pinta el seguimiento del domicilio', () => {
  afirmar(esPedidoEnOficina(EN_LA_OFICINA), 'no se reconoció como oficina');
  afirmar(hayRepartidor(EN_LA_OFICINA) === false, 'seguía pintando el seguimiento');
});

prueba('oficina · no se pinta el chat del domicilio', () => {
  afirmar(
    hayChatDelDomicilio(EN_LA_OFICINA) === false,
    'seguía ofreciendo un chat sin nadie al otro lado',
  );
});

// ══════════════════════════════════════════════════════════════════════════
// 2. LO QUE NO PUEDE CAMBIAR
// ══════════════════════════════════════════════════════════════════════════
prueba('domicilio normal · sigue viendo seguimiento y chat', () => {
  afirmar(hayRepartidor(DOMICILIO_NORMAL), 'se llevó por delante el domicilio de verdad');
  afirmar(hayChatDelDomicilio(DOMICILIO_NORMAL), 'se llevó por delante el chat');
});

prueba('domicilio sin empresa asignada · seguimiento sí, chat no', () => {
  const huerfano = { ...DOMICILIO_NORMAL, delivery: { status: 'WAITING_COURIER' } };
  afirmar(hayRepartidor(huerfano), 'el seguimiento se veía y se tiene que seguir viendo');
  afirmar(
    hayChatDelDomicilio(huerfano) === false,
    'el chat sin empresa no debe volver (salía en negocios que no usan domicilios)',
  );
});

prueba('payload viejo sin el campo · se comporta como siempre', () => {
  const { enOficina: _fuera, ...viejo } = DOMICILIO_NORMAL;
  afirmar(esPedidoEnOficina(viejo) === false, 'un campo ausente no es una oficina');
  afirmar(hayRepartidor(viejo), 'un pedido cacheado no puede perder su seguimiento');
});

prueba('pedido sin seguimiento · no hay nada que pintar', () => {
  afirmar(hayRepartidor({ status: 'PENDING', delivery: null }) === false, 'delivery null');
  afirmar(hayRepartidor({ status: 'PENDING' }) === false, 'sin delivery');
  afirmar(hayRepartidor(null) === false, 'sin pedido');
});

prueba('cancelados · ni seguimiento ni chat', () => {
  afirmar(
    hayRepartidor({ ...DOMICILIO_NORMAL, status: 'CANCELLED' }) === false,
    'pedido cancelado',
  );
  afirmar(
    hayRepartidor({ ...DOMICILIO_NORMAL, delivery: { ...SEGUIMIENTO, status: 'CANCELLED' } }) ===
      false,
    'seguimiento cancelado',
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

// El archivo está en CRLF (Windows + OneDrive): se normaliza antes de comparar
// o las anclas nunca casan y esto da un rojo falso.
const src = readFileSync(PANTALLA, 'utf8').replace(/\r\n/g, '\n');
const anclas = [
  "from '@/lib/pedido-en-oficina.mjs'",
  '{hayRepartidor(order) && (',
  '{hayChatDelDomicilio(order) && (',
];
const faltan = anclas.filter((a) => !src.includes(a));
if (faltan.length) {
  fallos++;
  console.log(
    `\nFALLA  la pantalla del pedido ya no usa lo que se prueba aquí:\n       ${faltan.join('\n       ')}`,
  );
} else {
  console.log('\nok     la pantalla del pedido usa la lógica probada aquí');
}

console.log(`\n${fallos === 0 ? 'TODO VERDE' : `${fallos} FALLO(S)`} — ${casos.length} casos`);
process.exit(fallos === 0 ? 0 : 1);
