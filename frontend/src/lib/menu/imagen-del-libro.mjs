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
  anchoPermitido,
  hostOptimizable,
  srcSetOptimizado,
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
