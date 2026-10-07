import type { FormatoDetectado } from './politica-de-archivos';

/**
 * Formato REAL de un archivo por sus primeros bytes («magic bytes»).
 *
 * Por qué no basta el `mimetype`: lo manda el navegador y lo deduce de la
 * EXTENSIÓN. Un `foto.jpg` que en realidad es un HEIC de iPhone, un PDF
 * renombrado o un HTML con extensión de imagen llegaban como `image/jpeg` y se
 * publicaban tal cual en el bucket público (cuando sharp fallaba se subía «el
 * original»). Lo que decide si algo se acepta es esto, no la extensión.
 */
export function detectarFormato(buf: Buffer | Uint8Array | null | undefined): FormatoDetectado {
  if (!buf || buf.length < 4) return 'desconocido';
  const b = buf;
  const ascii = (desde: number, largo: number) =>
    Buffer.from(b.subarray(desde, desde + largo)).toString('latin1');

  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    ascii(1, 3) === 'PNG' &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    return 'png';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'gif';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF') {
    const tipo = ascii(8, 4);
    if (tipo === 'WEBP') return 'webp';
    if (tipo === 'WAVE') return 'wav';
  }
  if (ascii(0, 5) === '%PDF-') return 'pdf';
  if (b.length >= 12 && ascii(4, 4) === 'ftyp') {
    // ISO-BMFF: la «marca» decide si es AVIF, HEIC (iPhone) o video.
    const marca = ascii(8, 4).toLowerCase();
    if (marca === 'avif' || marca === 'avis') return 'avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(marca)) {
      return 'heic';
    }
    return 'mp4'; // isom, mp42, qt  (mov), M4A , M4V …
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (ascii(0, 3) === 'ID3') return 'mp3';
  // Trama MPEG/ADTS sin etiqueta ID3 (mp3 y aac crudos).
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3';
  const inicio = ascii(0, Math.min(256, b.length)).trimStart().toLowerCase();
  if (inicio.startsWith('<svg') || (inicio.startsWith('<?xml') && inicio.includes('<svg'))) {
    return 'svg';
  }
  return 'desconocido';
}

/** Categoría para los usos que admiten de todo (adjuntos del CRM, comprobantes…). */
export function categoriaDeFormato(
  f: FormatoDetectado,
): 'image' | 'document' | 'audio' | 'video' | null {
  switch (f) {
    case 'jpeg':
    case 'png':
    case 'webp':
    case 'gif':
    case 'avif':
      return 'image';
    case 'pdf':
      return 'document';
    case 'mp3':
    case 'wav':
    case 'ogg':
      return 'audio';
    case 'mp4':
    case 'webm':
      return 'video';
    default:
      return null;
  }
}
