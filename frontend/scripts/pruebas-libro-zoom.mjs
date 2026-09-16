#!/usr/bin/env node
/**
 * Pruebas del ZOOM del menú libro.
 *
 *   node scripts/pruebas-libro-zoom.mjs
 *
 * Lo que se quería: que el cliente pueda ampliar la carta desde el móvil.
 *
 * Lo que estas pruebas cuidan tanto como eso: el fallo clásico de este tipo
 * de visor — ampliar, mover la imagen para leer una esquina, y que el visor
 * entienda ese arrastre como «pasar página». Por eso la regla dura: a escala
 * 1 la imagen NO se puede desplazar, y el desplazamiento nunca deja que la
 * imagen se salga de lo que se ve.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  PASO_DE_ZOOM,
  ZOOM_DOBLE_TOQUE,
  ZOOM_MAXIMO,
  ZOOM_MINIMO,
  distanciaEntreDedos,
  escalaDelPellizco,
  laRuedaAmplia,
  limitarDesplazamiento,
  limitarZoom,
  limiteDeArrastre,
  pasaPagina,
  pasoDeLaRueda,
  puntoMedio,
  zoomDelDobleToque,
  zoomHaciaUnPunto,
  zoomInicial,
} from '../src/lib/menu/zoom-del-libro.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const VISOR = resolve(AQUI, '../src/components/menu/MenuBookViewer.tsx');

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

// Un teléfono típico: la página ocupa el ancho completo del visor.
const MOVIL = { ancho: 390, alto: 700, anchoVisible: 390, altoVisible: 700 };
// Modo vertical: la imagen va en `object-contain` y es MÁS ESTRECHA que el hueco.
const VERTICAL = { ancho: 300, alto: 600, anchoVisible: 390, altoVisible: 600 };

// ══════════════════════════════════════════════════════════════════════════
// 1. LO QUE NO SE PUEDE ROMPER: el zoom no puede pasar página
// ══════════════════════════════════════════════════════════════════════════
prueba('a escala 1 la imagen NO se mueve — el slider sigue mandando', () => {
  igual(
    limitarDesplazamiento({ x: 250, y: 400 }, 1, MOVIL),
    { x: 0, y: 0 },
    'arrastre a escala 1',
  );
  afirmar(pasaPagina(1), 'a escala 1 tiene que pasar página');
  afirmar(pasaPagina(0.5), 'por debajo del mínimo también');
});

prueba('ampliado, el visor deja de pasar página', () => {
  afirmar(!pasaPagina(1.5), 'a 1,5 ya no pasa página');
  afirmar(!pasaPagina(ZOOM_MAXIMO), 'al máximo tampoco');
});

prueba('la imagen ampliada no se puede sacar de la pantalla', () => {
  // A escala 2 la imagen mide 780 en un hueco de 390: sobra 390, la mitad
  // a cada lado.
  igual(limiteDeArrastre(390, 390, 2), 195, 'límite horizontal a escala 2');
  igual(
    limitarDesplazamiento({ x: 10_000, y: -10_000 }, 2, MOVIL),
    { x: 195, y: -350 },
    'arrastre imposible recortado — cada eje a SU lado',
  );
  igual(
    limitarDesplazamiento({ x: -10_000, y: 10_000 }, 2, MOVIL),
    { x: -195, y: 350 },
    'y en el sentido contrario igual',
  );
});

prueba('en vertical, una imagen más estrecha que el hueco se queda centrada', () => {
  igual(limiteDeArrastre(300, 390, 1), 0, 'a escala 1 no sobra nada');
  igual(
    limitarDesplazamiento({ x: 120, y: 0 }, 1, VERTICAL),
    { x: 0, y: 0 },
    'no se descoloca',
  );
  // A escala 2 mide 600 en 390: ya sobra y se puede mover.
  igual(limiteDeArrastre(300, 390, 2), 105, 'a escala 2 sí');
});

// ══════════════════════════════════════════════════════════════════════════
// 2. LO QUE SE PEDÍA
// ══════════════════════════════════════════════════════════════════════════
prueba('el zoom no se sale del rango', () => {
  igual(limitarZoom(0.2), ZOOM_MINIMO, 'por debajo');
  igual(limitarZoom(99), ZOOM_MAXIMO, 'por encima');
  igual(limitarZoom(NaN), ZOOM_MINIMO, 'basura');
  igual(limitarZoom(2), 2, 'dentro');
});

prueba('el pellizco amplía en proporción a lo que se separan los dedos', () => {
  igual(escalaDelPellizco(1, 100, 200), 2, 'el doble de separación, el doble de zoom');
  igual(escalaDelPellizco(2, 100, 50), 1, 'juntar los dedos reduce');
  igual(escalaDelPellizco(1, 100, 10_000), ZOOM_MAXIMO, 'topa en el máximo');
  igual(escalaDelPellizco(1, 0, 100), 1, 'sin separación inicial no explota');
});

prueba('lo que estás tocando se queda quieto al ampliar', () => {
  // Punto a 100 px a la derecha del centro. Al pasar de 1 a 2, ese mismo
  // punto de la imagen tiene que seguir bajo el dedo.
  const r = zoomHaciaUnPunto({
    escala: 1,
    nuevaEscala: 2,
    desplazamiento: { x: 0, y: 0 },
    punto: { x: 100, y: 0 },
    medidas: MOVIL,
  });
  igual(r.escala, 2, 'escala');
  igual(r.desplazamiento.x, -100, 'la imagen se corre para dejar el punto quieto');
  // Comprobación de la cuenta: el punto de imagen q aparece en d + escala·q.
  const qAntes = 100; // a escala 1 y sin desplazamiento, q = el propio punto
  igual(r.desplazamiento.x + 2 * qAntes, 100, 'sigue bajo el dedo');
});

prueba('ampliar desde el centro no descoloca nada', () => {
  const r = zoomHaciaUnPunto({
    escala: 1,
    nuevaEscala: 2,
    desplazamiento: { x: 0, y: 0 },
    punto: { x: 0, y: 0 },
    medidas: MOVIL,
  });
  igual(r.desplazamiento, { x: 0, y: 0 }, 'centrado');
});

prueba('volver a 1 recoloca la imagen sola', () => {
  const r = zoomHaciaUnPunto({
    escala: 3,
    nuevaEscala: 1,
    desplazamiento: { x: 150, y: 200 },
    punto: { x: 0, y: 0 },
    medidas: MOVIL,
  });
  igual(r.escala, 1, 'escala');
  igual(r.desplazamiento, { x: 0, y: 0 }, 'sin desplazamiento residual');
});

prueba('el doble toque amplía, y el siguiente devuelve la página entera', () => {
  igual(zoomDelDobleToque(1), ZOOM_DOBLE_TOQUE, 'primer doble toque');
  igual(zoomDelDobleToque(ZOOM_DOBLE_TOQUE), ZOOM_MINIMO, 'segundo doble toque');
  igual(zoomDelDobleToque(4), ZOOM_MINIMO, 'desde cualquier ampliación');
});

prueba('la rueda NUNCA secuestra el desplazamiento de la página', () => {
  // Sin ampliar y sin Ctrl, la rueda es de la página: nadie queda atrapado.
  igual(laRuedaAmplia(1, false), false, 'sin ampliar, la página baja');
  igual(laRuedaAmplia(1, true), true, 'con Ctrl siempre amplía');
  igual(laRuedaAmplia(2, false), true, 'ya ampliado, la rueda es el zoom');
});

prueba('deslizar de LADO con el trackpad no encoge la página', () => {
  // El swipe lateral manda deltaY=0 (el gesto va en deltaX). Tratarlo como
  // «hacia abajo» iba reduciendo el zoom solo mientras el cliente se movía
  // de lado por una página ampliada.
  igual(pasoDeLaRueda(0), 0, 'sin gesto vertical no se toca el zoom');
  igual(pasoDeLaRueda(-0), 0, 'cero negativo');
  igual(pasoDeLaRueda(NaN), 0, 'basura');
  igual(pasoDeLaRueda(undefined), 0, 'ausente');
});

prueba('la rueda hacia arriba amplía y hacia abajo reduce', () => {
  afirmar(pasoDeLaRueda(-120) > 0, 'arriba amplía');
  afirmar(pasoDeLaRueda(120) < 0, 'abajo reduce');
  igual(pasoDeLaRueda(-120), PASO_DE_ZOOM, 'un paso entero');
});

prueba('la distancia y el centro entre dos dedos', () => {
  igual(distanciaEntreDedos({ x: 0, y: 0 }, { x: 3, y: 4 }), 5, 'distancia');
  igual(puntoMedio({ x: 0, y: 0 }, { x: 10, y: 20 }), { x: 5, y: 10 }, 'centro');
});

prueba('el estado inicial es la página entera sin desplazar', () => {
  igual(zoomInicial(), { escala: 1, desplazamiento: { x: 0, y: 0 } }, 'inicial');
  afirmar(PASO_DE_ZOOM > 0, 'el paso de los botones tiene que avanzar');
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

const visor = readFileSync(VISOR, 'utf8').replace(/\r\n/g, '\n');
const anclas = [
  "from '@/lib/menu/zoom-del-libro.mjs'",
  'limitarDesplazamiento(',
  'zoomHaciaUnPunto(',
  // Sin esto el navegador se queda el gesto y el arrastre pasa página.
  'touchAction',
  // El zoom vuelve a su sitio al cambiar de página.
  'zoomInicial()',
];
const faltan = anclas.filter((a) => !visor.includes(a));

// El doble clic de escritorio tiene que CANCELAR el temporizador del popup que
// armó el primer clic. Sin eso, ampliaba y abría el popup a la vez, encima de
// una página al 250 %. Se mira dentro del propio manejador, no en todo el
// archivo: un clearTimeout en otro sitio no arregla este caso.
const doble = visor.slice(visor.indexOf('onDoubleClick'), visor.indexOf('onDoubleClick') + 700);
if (!/clearTimeout/.test(doble)) {
  faltan.push('onDoubleClick tiene que cancelar el temporizador del popup (clearTimeout)');
}

if (faltan.length) {
  fallos++;
  console.log(`\nFALLA  el visor ya no usa lo que se prueba aquí:\n       ${faltan.join('\n       ')}`);
} else {
  console.log('\nok     el visor usa el zoom probado aquí');
}

console.log(`\n${fallos === 0 ? 'TODO VERDE' : `${fallos} FALLO(S)`} — ${casos.length} casos`);
process.exit(fallos === 0 ? 0 : 1);
