/**
 * Cómo se piden las imágenes del menú digital que NO son fotos de producto:
 * las portadas de sección, el logo del negocio y el aviso emergente.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Las fotos de producto ya pasaban por `next/image`. Estas tres no: iban con
 * la URL cruda del bucket, y se bajaba la ORIGINAL para pintarla pequeña.
 * Medido en producción (2026-09-17): las 15 portadas de Konys son 5 MB
 * (hasta 853 KB una sola, que a w=828 queda en 151 KB); hay logos de más de
 * 3 MB pintados en una caja de 260×140 px.
 *
 * Las reglas de CUÁNDO se puede usar el optimizador (y cuándo una imagen se
 * queda cruda para no salir en blanco) viven en `../imagen-optimizada.mjs`.
 * Aquí solo se decide qué anchos y qué calidad le tocan a cada uso.
 *
 *   node scripts/pruebas-imagenes-del-menu.mjs
 */

import {
  esOptimizable,
  srcSetOptimizado,
  urlOptimizada,
} from '../imagen-optimizada.mjs';

/**
 * Portada de sección: ocupa el ancho de la columna del menú (`max-w-2xl` con
 * `px-5`: 632 px como mucho) y 140 px de alto. Con `object-fit: cover` manda
 * el ancho. Hasta 1200: un teléfono de 390 px a 3x pide ~1.100, y el
 * escritorio a 2x (1.264) se queda en 1200 sin notarse — ir a 1920 para una
 * franja de 140 px de alto sería bajar píxeles que no se ven.
 */
export const IMAGEN_DE_PORTADA = Object.freeze({
  anchos: [640, 828, 1080, 1200],
  tamanos: '(max-width: 672px) calc(100vw - 40px), 632px',
  // Es una foto debajo de un degradado y de un título en CSS: el texto no
  // está en la imagen, así que 75 no se nota.
  calidad: 75,
});

/**
 * Aviso emergente: `max-w-sm` (384 px) dentro de un `p-4`. Suele ser un flyer
 * con precios y texto escrito EN la imagen, así que 85, como el menú libro.
 */
export const IMAGEN_DEL_AVISO = Object.freeze({
  anchos: [640, 828, 1080, 1200],
  tamanos: '(max-width: 416px) calc(100vw - 32px), 384px',
  calidad: 85,
});

/**
 * Logo: caja de 260×140 como mucho. UN solo ancho y SIN `srcset`, a propósito.
 *
 * El logo va con `w-auto h-auto`: su tamaño en pantalla sale del tamaño de la
 * imagen. Con un `srcset` de descriptores `w`, el navegador calcula ese
 * tamaño dividiendo por la densidad que deduce de `sizes`; y como el
 * optimizador NO amplía, un logo original de 300 px servido en la candidata
 * de 640 se pintaría a 300 / (640 / 260) = 122 px, la mitad de lo que se ve
 * hoy. Con un `src` simple la imagen conserva su tamaño natural (el menor
 * entre la original y 828) y la caja la limita igual que antes.
 *
 * 828 = 260 px a 3x, lo más nítido que puede hacer falta. Texto y bordes
 * finos: 85.
 */
export const IMAGEN_DEL_LOGO = Object.freeze({
  ancho: 828,
  calidad: 85,
});

/**
 * Props para un `<img>`: `{ src, srcSet, sizes }`, o solo `{ src }` cuando la
 * URL no se puede optimizar (se queda cruda: pesa más, pero se ve) o cuando el
 * uso es de un solo ancho.
 *
 * @param {unknown} url
 * @param {{ anchos?: readonly number[], ancho?: number, tamanos?: string, calidad: number }} uso
 * @returns {{ src: string, srcSet?: string, sizes?: string }}
 */
export function imagenDelMenu(url, uso) {
  const u = typeof url === 'string' ? url.trim() : '';
  if (!u) return { src: '' };
  if (!esOptimizable(u)) return { src: u };
  if (!uso.anchos || uso.anchos.length === 0) {
    return { src: urlOptimizada(u, uso.ancho ?? 828, uso.calidad) };
  }
  const srcSet = srcSetOptimizado(u, [...uso.anchos], uso.calidad);
  // El `src` solo lo usa un navegador sin `srcset`: el intermedio.
  const src = urlOptimizada(u, 828, uso.calidad);
  return srcSet ? { src, srcSet, sizes: uso.tamanos } : { src: u };
}

/**
 * `object-fit` equivalente al `background-size` que guarda el editor.
 *
 * La portada era un `background-image`; ahora es un `<img>` para que el
 * navegador elija el ancho con `srcset` y la cargue perezosa. Estas dos
 * funciones hacen que se vea EXACTAMENTE igual que antes.
 *
 * @param {unknown} bgFit
 * @returns {'cover' | 'contain' | 'none' | 'fill'}
 */
export function ajusteDeLaPortada(bgFit) {
  if (bgFit === 'contain') return 'contain';
  // `background-size: auto` pinta la imagen a su tamaño natural: `none`.
  if (bgFit === 'auto') return 'none';
  if (bgFit === '100% 100%') return 'fill';
  // Lo que ofrece el editor es cover/contain; cualquier otra cosa, cover.
  return 'cover';
}

/**
 * `object-position` equivalente al `background-position` guardado. Acepta la
 * misma sintaxis (palabras clave y porcentajes), así que se pasa tal cual;
 * solo se descarta lo que no parece una posición, que acabaría en un `style`.
 *
 * @param {unknown} bgPosition
 * @returns {string}
 */
export function posicionDeLaPortada(bgPosition) {
  if (typeof bgPosition !== 'string') return 'center';
  const v = bgPosition.trim();
  if (!v || !/^[a-z0-9.%\s-]+$/i.test(v)) return 'center';
  return v;
}
