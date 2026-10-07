/**
 * Cómo se piden las imágenes del InfoLink público (`/i/<negocio>/<enlace>`).
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * El InfoLink no pasaba NADA por el optimizador: el inventario del 2026-10-07
 * contó 405 imágenes servidas crudas (portada p50 467 KB, aviso p50 526 KB,
 * logos de 3 MB en un círculo de 112 px, la galería y los iconos propios de
 * los botones). Las portadas de los botones ya iban por `SectionCoverPreview`.
 *
 * Las reglas de CUÁNDO se puede usar el optimizador (y cuándo una imagen se
 * queda cruda para no salir en blanco) son las de `../imagen-optimizada.mjs`;
 * aquí solo se decide el ancho y la calidad de cada sitio. Todo cabe en
 * `max-w-md` (448 px).
 *
 *   node scripts/pruebas-imagenes-del-infolink.mjs
 */
import { esOptimizable, urlDeIcono } from '../imagen-optimizada.mjs';
import { fondoDelMenu, imagenDelMenu } from '../menu/imagen-del-menu.mjs';

/** Banner de cabecera (h-40 en 448 px) y fondo de página: fondo CSS, un solo ancho. */
export const FONDO_DEL_INFOLINK = Object.freeze({ ancho: 828, calidad: 70 });

/** Aviso emergente (modal `max-w-md`): flyer con texto → 85, como el del menú. */
export const AVISO_DEL_INFOLINK = Object.freeze({
  anchos: [640, 828, 1080],
  tamanos: '(max-width: 448px) 100vw, 448px',
  calidad: 85,
});

/** Imagen dentro del contenido de una página informativa (columna de ~408 px). */
export const IMAGEN_DEL_INFOLINK = Object.freeze({
  anchos: [640, 828, 1080],
  tamanos: '(max-width: 448px) calc(100vw - 40px), 408px',
  calidad: 80,
});

/**
 * Pide al optimizador un ancho de `imageSizes` (256/384, que Next acepta por
 * defecto). Para logos y miniaturas que se pintan entre 64 y 200 px.
 */
function urlChica(url, ancho, calidad) {
  if (!esOptimizable(url)) return typeof url === 'string' ? url : '';
  return `/_next/image?url=${encodeURIComponent(String(url).trim())}&w=${ancho}&q=${calidad}`;
}

/**
 * Logo del negocio: círculos de 64 a 112 px (336 a 3x). UN solo `src` a 384,
 * sin `srcset`, por lo mismo que `IMAGEN_DEL_LOGO` del menú: con `w-auto` el
 * tamaño en pantalla sale del archivo y un `srcset` encogería los logos
 * pequeños. La caja (max-w/max-h) lo limita igual que antes.
 */
export function logoDelInfolink(url) {
  return urlChica(url, 384, 85);
}

/** Foto de la galería (2 o 3 columnas, ~200 px: 640 cubre 3x). */
export function miniaturaDelInfolink(url) {
  return urlChica(url, 640, 75);
}

/** Círculo de «historia» (~56 px). */
export function historiaDelInfolink(url) {
  return urlDeIcono(url, 128, 75);
}

/** Icono propio de un botón (24–40 px). */
export function iconoDelInfolink(url) {
  return urlDeIcono(url, 96, 85);
}

/** `url("…")` para el banner y el fondo, por el optimizador si se puede. */
export function fondoDelInfolink(url) {
  return fondoDelMenu(url, FONDO_DEL_INFOLINK);
}

export { imagenDelMenu as imagenDelInfolink };
