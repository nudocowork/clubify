/**
 * Cómo se piden las imágenes del menú libro (`/book/<slug>`).
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * El visor del libro era la única superficie pública que se quedó con un
 * `<img src={page.imageUrl}>` plano contra el bucket. El menú digital
 * hermano (`/m/<slug>`) ya pasa las fotos de producto por `next/image`, con
 * el ahorro que dice su propio comentario. El libro no, así que al cliente
 * le bajaba el ORIGINAL de cada página: medido en producción, 1.275 px de
 * ancho y 473 KB de media (mediana 370) en la carta más grande —105 páginas,
 * 48,5 MB— para pintarlas en una ranura de ~390 px de un teléfono.
 *
 * El ahorro es real pero desigual, y conviene no prometer de más: al ancho
 * que pide un móvil (w=828) la mediana de las 206 páginas baja de 420 a
 * 113 KB, un 74 %. Los PNG ahorran un 95 % y los JPEG un 87 %, pero la mitad
 * de las páginas YA eran webp y ahí la mediana es 64 %, con casos del 46 %.
 *
 * Las funciones viven aquí y no dentro del componente para poder probarlas
 * desde node sin montar React:
 *   node scripts/pruebas-libro-imagenes.mjs
 */

import {
  ANCHOS_DE_ICONO,
  anchoPermitido,
  hostOptimizable,
  srcSetOptimizado,
  urlDeIcono,
  urlOptimizada as urlDelOptimizador,
} from '../imagen-optimizada.mjs';

// Lo que decide CUÁNDO se puede usar el optimizador (anchos que acepta, hosts,
// protocolo, rutas, SVG) vive desde el 2026-09-17 en `../imagen-optimizada.mjs`,
// compartido con las portadas, el logo y el aviso del menú digital. Aquí queda
// solo lo propio del libro. Se reexportan para no romper a quien ya los usa.
export { anchoPermitido, hostOptimizable };

/**
 * Los que de verdad sirven para una página de carta a ancho completo:
 * teléfono (640/828), teléfono grande y tablet (1080/1200) y escritorio
 * (1920). El visor no limita el ancho del slider, así que en un monitor
 * 100vw son ~1920 px reales.
 */
export const ANCHOS_DEL_LIBRO = [640, 828, 1080, 1200, 1920];

/**
 * Una carta es TEXTO: precios y descripciones que el cliente tiene que
 * poder leer. Por eso 85 y no el 75 por defecto — con 85 el ahorro medido
 * sigue siendo del orden del 90 % y no aparecen artefactos sobre la letra.
 */
export const CALIDAD_DEL_LIBRO = 85;

/** `sizes` del slide: cada página ocupa el ancho completo del visor. */
export const TAMANOS_DEL_LIBRO = '100vw';

/**
 * URL de una página pasada por el optimizador de Next, con la calidad del
 * libro. Relativa, y cruda cuando no se puede optimizar (ver
 * `../imagen-optimizada.mjs`): un 400 dejaría la página EN BLANCO.
 */
export function urlOptimizada(url, ancho) {
  return urlDelOptimizador(url, ancho, CALIDAD_DEL_LIBRO);
}

/**
 * `srcset` para que el navegador pida el tamaño que de verdad va a pintar.
 * Devuelve null cuando la URL no es optimizable: en ese caso el componente
 * deja el `<img>` como estaba y no escribe un srcset roto.
 */
export function srcSetDelLibro(url) {
  return srcSetOptimizado(url, ANCHOS_DEL_LIBRO, CALIDAD_DEL_LIBRO);
}

/**
 * Cómo se carga cada página según dónde esté el lector.
 *
 * La que se está mirando es la ÚNICA que importa para el primer pintado, y
 * hasta ahora era `loading="lazy"` sin prioridad: se le decía al navegador
 * que dejara para después justo la imagen que el cliente está esperando.
 *
 * La siguiente se precarga, pero con prioridad baja para no competir con la
 * que se ve. El resto, perezosas.
 *
 * Esto sustituye al `new window.Image()` que había en el visor: aquel
 * precargaba la URL ORIGINAL del bucket, así que se bajaba el archivo
 * completo de todas formas y anulaba el ahorro.
 */
export function cargaDeLaPagina(indice, indiceActivo) {
  if (indice === indiceActivo) return { loading: 'eager', fetchPriority: 'high' };
  if (indice === indiceActivo + 1) return { loading: 'eager', fetchPriority: 'low' };
  return { loading: 'lazy', fetchPriority: 'auto' };
}

// ══════════════════════════════════════════════════════════════════════════
// MODO LIBRO (las hojas de `LibroDeHojas.tsx`)
//
// Medido el 2026-10-07 en la carta de De Godoy (105 páginas), al abrir el
// enlace de «Platos fuertes»:
//   - las 105 hojas recibían `src` + `srcset` de golpe, con `sizes` al DOBLE
//     del ancho pintado: en un teléfono de DPR 2,625 el navegador elegía
//     1920 (mediana 165 KB por página) para una ranura de ~380 puntos;
//   - siete de ellas (±3 de la actual) arrancaban a la vez y sin prioridad,
//     peleando el ancho de banda con la única que el cliente está mirando;
//   - las 105 miniaturas pedían w=160, que `anchoPermitido` sube a 640
//     (mediana 62 KB cada una: 6,4 MB para pintar cuadritos de 31×40), y el
//     `loading="lazy"` no las frenaba dentro de la tira horizontal.
// Las funciones de abajo son la regla nueva; el componente solo la aplica.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Densidad mínima de píxeles por punto CSS de una hoja.
 *
 * Javier reportó el día del estreno del modo libro que a 1× la letra pequeña
 * de la carta se veía lavada, y por eso se pedía el DOBLE del ancho pintado.
 * Pero el navegador multiplicaba además por su DPR: en un teléfono de 2,625
 * eso eran 5,25 píxeles por punto, el doble de lo que la pantalla puede
 * mostrar. La regla es «al menos 2×»: en una pantalla 1× se sigue pidiendo
 * el doble (lo que arregló la letra) y en una retina se pide lo que la
 * pantalla pinta de verdad. Para leer de cerca está la lupa, en alta.
 */
export const DENSIDAD_MINIMA_DE_HOJA = 2;

/**
 * Cuánto por debajo del ideal se acepta un candidato antes de saltar al
 * siguiente. Sin margen, 602 × 2 = 1.204 descartaba 1.200 (a 4 píxeles) y
 * se bajaba 1.920, que es justo lo que hacía el navegador con el `sizes`
 * anterior. Un 10 % por debajo de 2× sigue siendo casi el doble que a 1×.
 */
const TOLERANCIA_DE_ANCHO = 0.9;

/**
 * Ancho que se pide para una hoja del libro, de la lista del libro.
 *
 * @param {number} anchoCss ancho en puntos CSS al que se pinta la hoja
 * @param {number} dpr      `devicePixelRatio` de la pantalla
 * @returns {number}        uno de ANCHOS_DEL_LIBRO
 */
export function anchoDeHoja(anchoCss, dpr) {
  const css = Number(anchoCss);
  const d = Number(dpr);
  // Sin medida, 1080: lo que el visor usaba de partida.
  if (!Number.isFinite(css) || css <= 0) return ANCHOS_DEL_LIBRO[2];
  const densidad = Math.max(Number.isFinite(d) && d > 0 ? d : 1, DENSIDAD_MINIMA_DE_HOJA);
  const ideal = css * densidad;
  for (const w of ANCHOS_DEL_LIBRO) {
    if (w >= ideal * TOLERANCIA_DE_ANCHO) return w;
  }
  return ANCHOS_DEL_LIBRO[ANCHOS_DEL_LIBRO.length - 1];
}

/**
 * URL de una hoja del libro: un único ancho calculado, sin `srcset`.
 *
 * Sin `srcset` a propósito: el libro ya conoce el tamaño exacto de la hoja
 * (lo calcula para StPageFlip) y se REMONTA en cada cambio de tamaño, de
 * orientación o de zoom del navegador, así que no hace falta que el
 * navegador adivine. Con `srcset` adivinaba de más (ver `anchoDeHoja`).
 */
export function urlDeHoja(url, anchoCss, dpr) {
  return urlOptimizada(url, anchoDeHoja(anchoCss, dpr));
}

/**
 * Ancho de la miniatura, de los `imageSizes` de Next (que el optimizador
 * también acepta, ver `../imagen-optimizada.mjs`). NO pasa por
 * `anchoPermitido`, que nunca baja de 640: ese suelo es justo lo que
 * convertía cada miniatura en una página entera.
 *
 * 128 cubre la miniatura de 31×40 puntos hasta DPR 3 en una carta vertical;
 * una apaisada (60 puntos) queda algo por debajo, que en un cuadrito para
 * reconocer la página no se nota. Fijo y no por DPR para que la miniatura
 * de la portada sea la MISMA URL con la que el libro mide la proporción:
 * una sola descarga sirve a las dos cosas.
 */
export const ANCHO_DE_MINIATURA = 128;

/**
 * Calidad de la miniatura. Es para reconocer la página, no para leerla: 70
 * basta. La hoja y la lupa siguen en CALIDAD_DEL_LIBRO. Medido contra
 * producción: 2-5 KB por miniatura frente a 62 KB (mediana) a w=640.
 */
export const CALIDAD_DE_MINIATURA = 70;

/** URL de la miniatura de una página (y de la imagen que mide la proporción). */
export function urlDeMiniatura(url) {
  if (!ANCHOS_DE_ICONO.includes(ANCHO_DE_MINIATURA)) {
    // Si alguien recorta la lista de iconos, mejor una miniatura pesada que
    // una que responda 400 y salga en blanco.
    return urlOptimizada(url, ANCHOS_DEL_LIBRO[0]);
  }
  return urlDeIcono(url, ANCHO_DE_MINIATURA, CALIDAD_DE_MINIATURA);
}

/**
 * Qué hojas se ven a la vez en el libro.
 *
 * Con `showCover` StPageFlip pinta la portada SOLA y luego pliegos
 * [1,2], [3,4]…; en pantalla estrecha (retrato) se ve una sola hoja.
 * `indice` puede llegar como la hoja derecha de un pliego (una miniatura
 * par, un chip de sección), así que se lleva a su pliego.
 *
 * @returns {number[]} índices visibles, dentro de [0, total)
 */
export function hojasVisibles(indice, total, doble) {
  const n = Math.max(0, Math.trunc(Number(total)) || 0);
  if (n === 0) return [];
  const i = Math.max(0, Math.min(n - 1, Math.trunc(Number(indice)) || 0));
  if (!doble || i === 0) return [i];
  const izquierda = i % 2 === 1 ? i : i - 1;
  return [izquierda, izquierda + 1].filter((k) => k < n);
}

/**
 * Qué hojas se adelantan, y solo DESPUÉS de que las visibles terminen.
 *
 * El pliego anterior y el siguiente: es lo que asoma en la animación de
 * pasar hoja (el dorso de la que se dobla ya es la siguiente). En retrato,
 * además, la de después de la siguiente, para el gesto rápido de pasar dos
 * seguidas. Antes se adelantaban ±3 desde el primer momento y a la vez que
 * la visible, y le quitaban ancho de banda.
 *
 * @returns {number[]} índices vecinos (sin repetir los visibles), el
 *                     siguiente primero: es la dirección en que se lee
 */
export function hojasVecinas(indice, total, doble) {
  const n = Math.max(0, Math.trunc(Number(total)) || 0);
  const vis = hojasVisibles(indice, n, doble);
  if (!vis.length) return [];
  const primera = vis[0];
  const ultima = vis[vis.length - 1];
  const out = doble
    ? [ultima + 1, ultima + 2, primera - 1, primera - 2]
    : [ultima + 1, ultima + 2, primera - 1];
  return [...new Set(out)].filter((k) => k >= 0 && k < n && !vis.includes(k));
}

/**
 * Esperas entre reintentos de una hoja que no cargó (ms). Tras el último, la
 * hoja queda con su aviso y se vuelve a intentar cuando regresa la red
 * (`online`) o cuando el cliente vuelve a esa página. Nunca una página en
 * blanco sin explicación.
 */
export const REINTENTOS_DE_HOJA = [1500, 4000, 10000];

/**
 * Margen, en puntos CSS a cada lado de lo que se ve de la tira, dentro del
 * cual una miniatura ya pide su imagen: ~4 miniaturas, para que al
 * deslizar la tira no aparezcan vacías.
 *
 * Hace falta un IntersectionObserver con la TIRA como `root`: el
 * `loading="lazy"` del navegador mide contra la ventana y con márgenes de
 * miles de píxeles, así que en una tira horizontal las cargaba todas.
 */
export const MARGEN_DE_LA_TIRA = 160;

/**
 * Si la tira de miniaturas se desliza animada hasta la actual.
 *
 * Igual que con el slider (ver `desplazamientoDelSalto`): animar un salto
 * largo arrastra la tira por todas las miniaturas de en medio, y cada una
 * que asoma dispararía su descarga.
 */
export function desplazamientoDeLaTira(desde, hasta) {
  return Math.abs(Number(hasta) - Number(desde)) <= 2 ? 'smooth' : 'instant';
}

/**
 * Si el salto entre páginas se anima o es instantáneo.
 *
 * Un `scrollTo` suave ARRASTRA la ventana por todas las páginas que hay en
 * medio, y cada una que asoma dispara su imagen. En la carta de 105 páginas,
 * tocar el chip de la última sección se bajaba el libro entero de golpe.
 *
 * Pasar de una en una (los botones ← →) sí se anima: ahí solo hay una página
 * en medio y la animación es lo que hace que se sienta un libro.
 */
export function desplazamientoDelSalto(desde, hasta) {
  // `'instant'` y NO `'auto'`: según la spec, `auto` significa «usa el
  // `scroll-behavior` computado del elemento», y el scroller lleva la clase
  // `scroll-smooth`. O sea que `auto` ahí es EXACTAMENTE lo contrario de lo
  // que parece — seguía animando el salto y arrastrando la ventana por todas
  // las páginas de en medio. `instant` no anima, diga lo que diga el CSS.
  return Math.abs(Number(hasta) - Number(desde)) <= 1 ? 'smooth' : 'instant';
}
