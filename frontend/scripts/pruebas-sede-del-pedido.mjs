#!/usr/bin/env node
/**
 * Pruebas de «qué sede sirve el pedido y de qué estado es».
 *
 *   node scripts/pruebas-sede-del-pedido.mjs
 *
 * Cubre el bug que Javier reportó dos veces: en el menú de domicilio de Quipao
 * Bubble Tea, entrando por el enlace de la sede de Nueva Esparta, el checkout
 * seguía preguntando en qué ESTADO quería hacer el pedido. La sede ya estaba
 * decidida por el enlace; el estado solo servía para deducirla.
 *
 * Los datos de las sedes son los REALES de producción (2026-09-16): las tres
 * tienen `state` vacío y el estado escrito dentro de la dirección. Ese detalle
 * es justo el que hacía que el arreglo anterior —«si el negocio tiene sede en
 * un solo estado, no preguntes»— no se activara nunca en este negocio.
 *
 * El frontend no tiene runner de pruebas y montar uno para esto era
 * desproporcionado, así que esto es un script suelto sin dependencias. Pero a
 * diferencia de `pruebas-lienzo-workflows.mjs`, aquí NO se replica la lógica:
 * se importa la de verdad, la misma que corre en el navegador. Al final se
 * comprueba además que el componente la sigue usando — si alguien vuelve a
 * meter la decisión dentro del .tsx, esto se pone en rojo en vez de seguir
 * dando verde sobre código que ya no se ejecuta.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  estadoDeLaSede,
  estadoEnLaDireccion,
  normalizarTexto,
  regionesConSede,
  resolverSedeYEstado,
  sedeYaConocida,
  sedesDelEstado,
} from '../src/lib/sede-del-pedido.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const COMPONENTE = resolve(AQUI, '../src/app/m/[slug]/storefront-client.tsx');
const REGIONES_TS = resolve(AQUI, '../src/lib/regions.ts');

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

// ══════════════════════════════════════════════════════════════════════════
// Datos: los estados de Venezuela salen del archivo REAL, no de una copia.
// Si alguien renombra «Nueva Esparta» allí, estas pruebas se enteran.
// ══════════════════════════════════════════════════════════════════════════
const fuenteRegiones = readFileSync(REGIONES_TS, 'utf8').replace(/\r\n/g, '\n');
const bloqueVE = fuenteRegiones.slice(
  fuenteRegiones.indexOf('const VENEZUELA_REGIONS'),
  fuenteRegiones.indexOf('const BELIZE_REGIONS'),
);
const VE = [...bloqueVE.matchAll(/name: '([^']+)', cities: \[([^\]]*)\]/g)].map(
  (m) => ({
    name: m[1],
    cities: [...m[2].matchAll(/'([^']+)'/g)].map((c) => c[1]),
  }),
);
if (VE.length < 10) {
  console.log('FALLA  no se pudieron leer los estados de Venezuela de regions.ts');
  process.exit(1);
}

/** Las tres sedes de Quipao Bubble Tea, tal cual están en producción. */
const MARGARITA = {
  id: '50bb2564-19a0-467f-ac29-d20e1e1b77c0',
  name: 'Sambil ︎Margarita',
  state: null,
  address:
    'Avenida Jóvito Villalba,, Sector San Lorenzo,, Pampatar 6316, Nueva Esparta, Venezuela',
};
const SAN_CRISTOBAL = {
  id: 'b3b79ea5-cb5c-4bd7-82fe-f3e2dea6ae96',
  name: 'Quipao Bubble Tea',
  state: null,
  address: 'Sambil, San Cristóbal 5001, Táchira, Venezuela',
};
const CERRO_VERDE = {
  id: '6b575f8f-8efb-4cf8-9395-71538a4bec9f',
  name: 'Parque cerro verde',
  state: null,
  address: 'Residencias Los Claveles, Caracas 1080, Miranda, Venezuela',
};
const QUIPAO = [CERRO_VERDE, SAN_CRISTOBAL, MARGARITA];

// ══════════════════════════════════════════════════════════════════════════
// 1. EL BUG: el enlace de una sede no puede preguntar el estado
// ══════════════════════════════════════════════════════════════════════════
prueba('quipao · ?sede= de Nueva Esparta NO pregunta el estado', () => {
  const r = resolverSedeYEstado({
    sedes: QUIPAO,
    sedeDelQr: MARGARITA.id,
    regiones: VE,
  });
  afirmar(r.preguntarEstado === false, 'seguía preguntando el estado');
  igual(r.sedeConocida?.id, MARGARITA.id, 'sede del enlace');
  igual(r.estadoFijo, 'Nueva Esparta', 'estado que se rellena solo');
});

prueba('quipao · el estado sale de la dirección, no del campo state', () => {
  // Las tres tienen `state` vacío: si esto se rompe, volvemos al bug.
  afirmar(
    QUIPAO.every((s) => !s.state),
    'las sedes de la prueba ya no reproducen el caso real',
  );
  igual(estadoDeLaSede(MARGARITA, VE), 'Nueva Esparta', 'Margarita');
  igual(estadoDeLaSede(SAN_CRISTOBAL, VE), 'Táchira', 'San Cristóbal');
  igual(estadoDeLaSede(CERRO_VERDE, VE), 'Miranda', 'Cerro Verde');
});

prueba('quipao · el enlace general SÍ pregunta, y solo sus 3 estados', () => {
  const r = resolverSedeYEstado({ sedes: QUIPAO, sedeDelQr: '', regiones: VE });
  afirmar(r.preguntarEstado === true, 'dejó de preguntar sin saber la sede');
  igual(r.sedeConocida, null, 'no hay sede conocida');
  igual(
    r.regionesDelNegocio.map((x) => x.name),
    ['Miranda', 'Táchira', 'Nueva Esparta'],
    'estados ofrecidos',
  );
});

prueba('quipao · elegir el estado rutea a la sede de ese estado', () => {
  igual(
    sedesDelEstado(QUIPAO, 'Nueva Esparta', VE).map((s) => s.id),
    [MARGARITA.id],
    'sede del estado elegido',
  );
  igual(sedesDelEstado(QUIPAO, 'Zulia', VE).length, 0, 'estado sin sede');
  igual(sedesDelEstado(QUIPAO, '', VE).length, 0, 'sin estado elegido');
});

// ══════════════════════════════════════════════════════════════════════════
// 2. UNA SOLA SEDE: no hay nada que elegir
// ══════════════════════════════════════════════════════════════════════════
prueba('una sola sede · no pregunta el estado', () => {
  const r = resolverSedeYEstado({ sedes: [MARGARITA], regiones: VE });
  afirmar(r.preguntarEstado === false, 'preguntaba con una sola sede');
  igual(r.estadoFijo, 'Nueva Esparta', 'estado de la única sede');
});

prueba('una sola sede sin estado deducible · tampoco pregunta', () => {
  const sede = { id: 'x', name: 'Local', state: null, address: 'Calle 5 #3-20' };
  const r = resolverSedeYEstado({ sedes: [sede], regiones: VE });
  afirmar(r.preguntarEstado === false, 'preguntaba un dato que no sirve');
  igual(r.estadoFijo, null, 'no se inventa un estado');
  igual(r.sedeConocida?.id, 'x', 'la sede sigue resuelta');
});

prueba('varias sedes en el MISMO estado · no hay estado que elegir', () => {
  const otra = { ...MARGARITA, id: 'otra', name: 'Porlamar centro' };
  const r = resolverSedeYEstado({ sedes: [MARGARITA, otra], regiones: VE });
  afirmar(r.preguntarEstado === false, 'preguntaba con un solo estado posible');
  igual(r.estadoFijo, 'Nueva Esparta', 'estado único del negocio');
});

// ══════════════════════════════════════════════════════════════════════════
// 3. ENLACES ROTOS: un ?sede= que no es de este negocio no manda
// ══════════════════════════════════════════════════════════════════════════
prueba('?sede= inexistente · el cliente sigue el camino normal', () => {
  const r = resolverSedeYEstado({
    sedes: QUIPAO,
    sedeDelQr: 'no-existe',
    regiones: VE,
  });
  igual(r.sedeConocida, null, 'no se ata a una sede inventada');
  afirmar(r.preguntarEstado === true, 'tiene que poder elegir');
});

prueba('?sede= de otro negocio · igual que sin sede', () => {
  const r = resolverSedeYEstado({
    sedes: QUIPAO,
    sedeDelQr: '00000000-0000-0000-0000-000000000000',
    regiones: VE,
  });
  igual(r.sedeConocida, null, 'sede ajena ignorada');
});

prueba('?sede= vacío o con espacios · no cuenta como sede', () => {
  igual(sedeYaConocida(QUIPAO, '   '), null, 'espacios');
  igual(sedeYaConocida(QUIPAO, null), null, 'null');
  igual(sedeYaConocida([], MARGARITA.id), null, 'negocio sin sedes');
});

// ══════════════════════════════════════════════════════════════════════════
// 4. LA SALIDA DE EMERGENCIA: «¿No está? Agrega tu ubicación»
// ══════════════════════════════════════════════════════════════════════════
prueba('mostrarTodos · el cliente de fuera vuelve a elegir', () => {
  const r = resolverSedeYEstado({
    sedes: QUIPAO,
    sedeDelQr: MARGARITA.id,
    regiones: VE,
    mostrarTodos: true,
  });
  afirmar(r.preguntarEstado === true, 'no lo dejaba elegir otro estado');
  igual(r.estadoFijo, null, 'ya no hay estado fijo');
  igual(r.sedeConocida?.id, MARGARITA.id, 'la sede del enlace no se pierde');
});

// ══════════════════════════════════════════════════════════════════════════
// 5. DEDUCIR EL ESTADO: prudente antes que listo
// ══════════════════════════════════════════════════════════════════════════
prueba('el campo state manda sobre la dirección', () => {
  const sede = { ...MARGARITA, state: 'Zulia' };
  igual(estadoDeLaSede(sede, VE), 'Zulia', 'gana lo declarado');
});

prueba('el state escrito a mano se devuelve con el nombre curado', () => {
  // Importa: las ciudades del checkout se buscan por igualdad exacta contra
  // el nombre de la región; «tachira» dejaría al cliente sin ciudades.
  igual(
    estadoDeLaSede({ id: 'a', name: 'a', state: 'tachira' }, VE),
    'Táchira',
    'normalizado al nombre curado',
  );
});

prueba('una avenida con nombre de estado NO convierte la sede', () => {
  igual(
    estadoEnLaDireccion('Avenida Sucre, Caracas 1010, Venezuela', VE),
    null,
    'no se inventa Sucre',
  );
});

prueba('si la dirección nombra dos estados, vale el último', () => {
  igual(
    estadoEnLaDireccion('Calle Mérida, San Cristóbal, Táchira, Venezuela', VE),
    'Táchira',
    'el de más a la derecha',
  );
});

prueba('país sin estados curados · se usa lo que haya', () => {
  igual(
    estadoDeLaSede({ id: 'a', name: 'a', state: 'Kanto' }, []),
    'Kanto',
    'state crudo',
  );
  igual(
    estadoDeLaSede({ id: 'a', name: 'a', state: null, address: 'Kanto' }, []),
    null,
    'sin regiones no se deduce nada',
  );
});

prueba('normalizarTexto compara sin tildes ni mayúsculas', () => {
  igual(normalizarTexto(' TÁCHIRA '), 'tachira', 'tildes y espacios');
  igual(normalizarTexto(null), '', 'nulo');
});

prueba('regionesConSede no repite ni inventa', () => {
  igual(
    regionesConSede([MARGARITA, MARGARITA], VE).map((r) => r.name),
    ['Nueva Esparta'],
    'sin duplicados',
  );
  igual(regionesConSede([], VE).length, 0, 'negocio sin sedes');
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

// Esto solo vale si el checkout usa de verdad lo que se prueba aquí. El
// archivo está en CRLF (Windows + OneDrive), así que se normaliza antes de
// comparar: si no, las anclas de varias líneas nunca casan y da un rojo falso.
const src = readFileSync(COMPONENTE, 'utf8').replace(/\r\n/g, '\n');
const anclas = [
  "from '@/lib/sede-del-pedido.mjs'",
  'resolverSedeYEstado({',
  'const matchingSedes = sedesDelEstado(',
  '{!preguntarEstado ? (',
  '(preguntarEstado && !form.departamento) ||',
  'if (estadoFijo && !form.departamento) {',
];
const faltan = anclas.filter((a) => !src.includes(a));
if (faltan.length) {
  fallos++;
  console.log(
    `\nFALLA  el checkout ya no usa lo que se prueba aquí:\n       ${faltan.join('\n       ')}`,
  );
} else {
  console.log('\nok     el checkout usa la lógica probada aquí');
}

console.log(`\n${fallos === 0 ? 'TODO VERDE' : `${fallos} FALLO(S)`} — ${casos.length} casos`);
process.exit(fallos === 0 ? 0 : 1);
