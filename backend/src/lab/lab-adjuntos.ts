import { BadRequestException } from '@nestjs/common';

/**
 * Adjuntos del Lab: qué se puede subir a una propuesta y qué no.
 *
 * Por qué existe. «Nueva propuesta» solo tenía un campo «URL de adjunto», así
 * que para enseñar una pantalla había que subirla antes a otro sitio y pegar el
 * enlace. Javier pidió (2026-09-16) poder adjuntar imágenes o video de verdad
 * desde el formulario. Se sube por `MediaService` —igual que el resto del
 * producto— y en la propuesta se guarda SOLO la URL: una imagen dentro de la
 * base la hizo crecer hasta que QrPoster fue el 77% de ella.
 *
 * Aquí viven las reglas puras (tipos, topes y el saneado de una URL pegada a
 * mano) para poder probarlas sin levantar Nest ni tocar el bucket.
 */

// Los mismos tipos que ya acepta `media.service.ts`. Repetirlos aquí y no
// importarlos es a propósito: el Lab acepta MENOS que el resto del producto
// (ni audio ni PDF), y si mañana media abre un tipo nuevo no debe colarse solo.
const IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];

/** Imagen: el tope normal del producto; sharp la reduce a 2560px + WebP. */
export const LAB_MAX_IMAGEN_BYTES = 15 * 1024 * 1024;
/**
 * Vídeo: el techo que ya tiene la plataforma (`MAX_SIZE_VIDEO`). No se
 * recomprime —no hay ffmpeg en el contenedor—, así que sube tal cual.
 */
export const LAB_MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/**
 * Tope de multer para la ruta de subida. Sin un `limits` explícito, multer
 * trunca los archivos grandes en silencio y el adjunto llega roto al bucket.
 */
export const LAB_LIMITE_MULTER_BYTES = LAB_MAX_VIDEO_BYTES;

/** Carpeta del bucket. Sin `tenantId`: una propuesta no es de un negocio. */
export const LAB_CARPETA_ADJUNTOS = 'lab';

/** Para el `accept` del input del formulario: lo mismo que valida el backend. */
export const LAB_ADJUNTO_ACCEPT = [...IMAGEN, ...VIDEO].join(',');

export type ClaseAdjunto = 'image' | 'video';

export function claseDeAdjunto(mimetype: string): ClaseAdjunto | null {
  if (IMAGEN.includes(mimetype)) return 'image';
  if (VIDEO.includes(mimetype)) return 'video';
  return null;
}

export function topeDe(clase: ClaseAdjunto): number {
  return clase === 'video' ? LAB_MAX_VIDEO_BYTES : LAB_MAX_IMAGEN_BYTES;
}

function mb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

/**
 * Tipo y tamaño de lo que se sube. Lanza con el motivo en español: el mensaje
 * lo lee quien está adjuntando, no un log.
 */
export function validarAdjuntoLab(file: {
  mimetype: string;
  size: number;
} | null | undefined): ClaseAdjunto {
  if (!file) {
    throw new BadRequestException('No llegó ningún archivo.');
  }
  const clase = claseDeAdjunto(file.mimetype);
  if (!clase) {
    throw new BadRequestException(
      'Solo se pueden adjuntar imágenes (JPG, PNG, WebP, GIF) o videos (MP4, MOV, WebM).',
    );
  }
  const tope = topeDe(clase);
  if (file.size > tope) {
    throw new BadRequestException(
      clase === 'video'
        ? `El video pesa demasiado (máximo ${mb(tope)} MB).`
        : `La imagen pesa demasiado (máximo ${mb(tope)} MB).`,
    );
  }
  return clase;
}

/**
 * Una URL pegada a mano se sigue aceptando (es lo que había antes), pero solo
 * http/https: el adjunto se pinta como enlace y como `<img>`/`<video>`, y un
 * `javascript:` ahí sería un XSS servido con nuestro dominio.
 */
export function urlDeAdjuntoValida(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Tipo de un adjunto pegado por URL, por la extensión. Es una pista para
 * decidir si se pinta como imagen, como video o como enlace: no hay forma de
 * saberlo de verdad sin descargarlo, y descargar lo que nos pasen abriría un
 * SSRF.
 */
export function tipoDeAdjuntoPorUrl(url: string): string {
  const ruta = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (/\.(png|jpe?g|webp|gif)$/.test(ruta)) return 'image';
  if (/\.(mp4|webm|mov|m4v)$/.test(ruta)) return 'video';
  if (/\.pdf$/.test(ruta)) return 'pdf';
  return 'document';
}

/**
 * Deja la propuesta con un adjunto coherente: sin URL válida no se guarda nada
 * (ni la URL ni el tipo), para que el detalle no pinte un «📎 Ver adjunto» que
 * no lleva a ninguna parte.
 */
export function normalizarAdjunto(dto: {
  attachmentUrl?: string | null;
  attachmentKind?: string | null;
}): { attachmentUrl: string | null; attachmentKind: string | null } {
  const url = (dto.attachmentUrl ?? '').trim();
  if (!url) return { attachmentUrl: null, attachmentKind: null };
  if (!urlDeAdjuntoValida(url)) {
    throw new BadRequestException(
      'El enlace del adjunto no es válido: debe empezar por http:// o https://.',
    );
  }
  // El tipo que manda el front es una pista, no un permiso: se acepta solo si
  // es uno de los que sabemos pintar, y si no, se deduce de la extensión.
  const declarado = (dto.attachmentKind ?? '').trim().toLowerCase();
  const kind = ['image', 'video', 'pdf', 'document'].includes(declarado)
    ? declarado
    : tipoDeAdjuntoPorUrl(url);
  return { attachmentUrl: url, attachmentKind: kind };
}
