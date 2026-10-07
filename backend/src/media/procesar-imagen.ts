import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { detectarFormato } from './detectar-formato';
import {
  formatosLegibles,
  mensajeDePesoExcedido,
  type FormatoDeImagen,
  type PoliticaDeImagen,
} from './politica-de-archivos';

/**
 * Lo que se le dice al negocio cuando su imagen no se puede publicar. Es un
 * error «esperado»: el servicio lo convierte en un 400 con este mensaje tal
 * cual, en español. Cualquier otra excepción es un fallo nuestro.
 */
export class ArchivoRechazado extends Error {
  constructor(
    message: string,
    readonly motivo:
      | 'peso'
      | 'formato'
      | 'corrupto'
      | 'dimensiones'
      | 'megapixeles'
      | 'procesamiento',
  ) {
    super(message);
    this.name = 'ArchivoRechazado';
  }
}

export interface ImagenProcesada {
  buffer: Buffer;
  contentType: string;
  ext: string;
  ancho: number;
  alto: number;
  tieneAlfa: boolean;
  animada: boolean;
  /** 20 hex del sha256 del maestro: nombre del archivo en el bucket. */
  hash: string;
}

export interface ResultadoDeProcesar {
  maestro: ImagenProcesada;
  /** Variantes que SÍ se guardan en el bucket (miniaturas), por ancho. */
  variantes: Array<ImagenProcesada & { ancho: number }>;
  original: { bytes: number; formato: FormatoDeImagen; ancho: number; alto: number };
}

/**
 * El nombre de una variante guardada a partir de la clave del maestro.
 * `t/menu-book/<hash>.webp` → `t/menu-book/<hash>.w160.webp`. Lo comparten el
 * servidor, la migración y el frontend (`variantesGuardadasDe`): la URL del
 * maestro lleva en sí dónde están sus miniaturas, sin columna nueva en la base.
 */
export function claveDeVariante(claveMaestro: string, ancho: number): string {
  return claveMaestro.replace(/\.[a-z0-9]+$/i, '') + `.w${ancho}.webp`;
}

/** Hash con el que se nombra el maestro (contenido → URL versionada). */
export function hashDe(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 20);
}

const MIME: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
};

/**
 * Valida y procesa una imagen según su política. Todo o nada: si devuelve, el
 * maestro y sus variantes decodifican, tienen las dimensiones esperadas y
 * conservan la transparencia; si no, lanza `ArchivoRechazado` y NO hay nada
 * que publicar. Antes, si sharp fallaba se subía el original «para no
 * bloquear»: así llegaron al menú originales de varios MB y archivos que ni
 * siquiera eran imágenes.
 */
export async function procesarImagen(
  buffer: Buffer,
  politica: PoliticaDeImagen,
): Promise<ResultadoDeProcesar> {
  if (buffer.length > politica.maxBytesOriginal) {
    throw new ArchivoRechazado(
      mensajeDePesoExcedido({
        bytes: buffer.length,
        maximo: politica.maxBytesOriginal,
        etiqueta: politica.etiqueta,
      }),
      'peso',
    );
  }

  const formato = detectarFormato(buffer);
  if (formato === 'heic') {
    throw new ArchivoRechazado(
      'Esta foto está en formato HEIC (el de los iPhone) y no se puede publicar así. ' +
        'Expórtala como JPG o, en el iPhone, ve a Ajustes › Cámara › Formatos y elige «Más compatible».',
      'formato',
    );
  }
  if (!(politica.formatos as string[]).includes(formato)) {
    throw new ArchivoRechazado(
      `El archivo no es una imagen ${formatosLegibles(politica.formatos)} válida ` +
        `(su contenido no coincide con su extensión). Selecciona otra imagen.`,
      'formato',
    );
  }
  const fmt = formato as FormatoDeImagen;

  // `limitInputPixels` es el candado contra las «bombas de descompresión»: un
  // PNG de 50 KB que declara 30.000 × 30.000 px reventaría la memoria del
  // contenedor al decodificarlo. sharp lo rechaza ANTES de reservar memoria.
  const limitInputPixels = Math.round(politica.maxMegapixeles * 1_000_000);
  const animado = politica.admiteAnimacion && (fmt === 'gif' || fmt === 'webp');
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buffer, { limitInputPixels, failOn: 'error', animated: animado }).metadata();
  } catch (e: any) {
    throw rechazoDeSharp(e);
  }
  const paginas = meta.pages ?? 1;
  const ancho = meta.width ?? 0;
  const altoTotal = meta.height ?? 0;
  const alto = animado && paginas > 1 ? (meta.pageHeight ?? altoTotal) : altoTotal;
  if (!ancho || !alto) {
    throw new ArchivoRechazado('No pudimos leer las dimensiones de la imagen. Selecciona otra.', 'corrupto');
  }
  // EXIF 5–8 = girada 90°: el lado «ancho» real es el alto.
  const girada = (meta.orientation ?? 1) >= 5;
  const anchoReal = girada ? alto : ancho;
  const altoReal = girada ? ancho : alto;
  if (Math.max(anchoReal, altoReal) > politica.ladoMaximoOriginal) {
    throw new ArchivoRechazado(
      `La imagen mide ${anchoReal} × ${altoReal} px. El máximo para ${politica.etiqueta} es ` +
        `${politica.ladoMaximoOriginal} px por lado. Redúcela o selecciona otra.`,
      'dimensiones',
    );
  }
  if (anchoReal * altoReal * (animado ? paginas : 1) > limitInputPixels) {
    throw new ArchivoRechazado(
      `La imagen tiene demasiados píxeles (${((anchoReal * altoReal) / 1e6).toFixed(0)} megapíxeles). ` +
        `El máximo para ${politica.etiqueta} es ${politica.maxMegapixeles}. Redúcela o selecciona otra.`,
      'megapixeles',
    );
  }
  const tieneAlfa = politica.conservarAlfa && meta.hasAlpha === true && (await usaAlfa(buffer, limitInputPixels));
  const esAnimada = animado && paginas > 1;

  const maestro = await codificar(buffer, {
    politica,
    lado: politica.ladoMaestro,
    calidad: politica.calidad,
    tieneAlfa,
    animada: esAnimada,
    limitInputPixels,
    formatoOriginal: fmt,
  });

  const variantes: ResultadoDeProcesar['variantes'] = [];
  for (const w of politica.variantesGuardadas) {
    let calidad = Math.min(politica.calidad, 75);
    let v = await variante(buffer, w, calidad, tieneAlfa, limitInputPixels);
    // El presupuesto de una miniatura sí se persigue bajando calidad (hasta
    // `calidadMinima`): a 80–160 px no hay texto que leer, y una tira de 30
    // miniaturas de 40 KB es lo que hacía lenta la barra del libro.
    while (
      politica.presupuestoVariante > 0 &&
      v.buffer.length > politica.presupuestoVariante &&
      calidad - 10 >= politica.calidadMinima
    ) {
      calidad -= 10;
      v = await variante(buffer, w, calidad, tieneAlfa, limitInputPixels);
    }
    variantes.push({ ...v, ancho: v.ancho });
  }

  return {
    maestro,
    variantes,
    original: { bytes: buffer.length, formato: fmt, ancho: anchoReal, alto: altoReal },
  };
}

/**
 * `hasAlpha` solo dice que el archivo TIENE canal alfa, no que lo use: muchos
 * PNG exportados de Canva traen alfa con todo opaco. Conservarlo en esos casos
 * obliga a PNG en los usos `compatible` (logo de 600 KB en vez de un JPEG de
 * 60). Se mira el mínimo real del canal.
 */
async function usaAlfa(buffer: Buffer, limitInputPixels: number): Promise<boolean> {
  try {
    const st = await sharp(buffer, { limitInputPixels, failOn: 'error' }).stats();
    const a = st.channels[3];
    return !!a && a.min < 255;
  } catch {
    return true; // ante la duda, conservar la transparencia
  }
}

async function codificar(
  buffer: Buffer,
  o: {
    politica: PoliticaDeImagen;
    lado: number;
    calidad: number;
    tieneAlfa: boolean;
    animada: boolean;
    limitInputPixels: number;
    formatoOriginal: FormatoDeImagen;
  },
): Promise<ImagenProcesada> {
  let salida: Buffer;
  let ext: string;
  try {
    // `.rotate()` sin argumentos aplica la orientación EXIF y la quita. Sin
    // él, al re-codificar (que descarta los metadatos) una foto de teléfono
    // tomada en vertical quedaba ACOSTADA en el menú.
    let p = sharp(buffer, {
      limitInputPixels: o.limitInputPixels,
      failOn: 'error',
      animated: o.animada,
    })
      .rotate()
      .resize({ width: o.lado, height: o.lado, fit: 'inside', withoutEnlargement: true });

    if (o.animada) {
      if (o.politica.formatoMaestro === 'compatible') {
        p = p.gif({ effort: 7 });
        ext = 'gif';
      } else {
        p = p.webp({ quality: o.calidad, effort: 4 });
        ext = 'webp';
      }
    } else if (o.politica.formatoMaestro === 'webp') {
      p = p.webp({
        quality: o.calidad,
        alphaQuality: 90,
        effort: 5,
        // Muestreo de croma «inteligente»: sin él, el texto rojo o azul fino
        // sobre fondo claro (precios en una carta) se emborrona.
        smartSubsample: true,
      });
      ext = 'webp';
    } else if (o.tieneAlfa) {
      p = p.png({ compressionLevel: 9, palette: true, quality: 90, effort: 8 });
      ext = 'png';
    } else {
      p = p.flatten({ background: '#ffffff' }).jpeg({ quality: o.calidad, mozjpeg: true });
      ext = 'jpeg';
    }
    salida = await p.toBuffer();
  } catch (e: any) {
    throw rechazoDeSharp(e);
  }
  const v = await verificar(salida, o.tieneAlfa, o.animada);
  return {
    buffer: salida,
    contentType: MIME[ext],
    ext: ext === 'jpeg' ? 'jpg' : ext,
    ancho: v.ancho,
    alto: v.alto,
    tieneAlfa: v.tieneAlfa,
    animada: o.animada,
    hash: hashDe(salida),
  };
}

async function variante(
  buffer: Buffer,
  ancho: number,
  calidad: number,
  tieneAlfa: boolean,
  limitInputPixels: number,
): Promise<ImagenProcesada> {
  let salida: Buffer;
  try {
    salida = await sharp(buffer, { limitInputPixels, failOn: 'error' })
      .rotate()
      .resize({ width: ancho, withoutEnlargement: true })
      .webp({ quality: calidad, alphaQuality: 80, effort: 6, smartSubsample: true })
      .toBuffer();
  } catch (e: any) {
    throw rechazoDeSharp(e);
  }
  const v = await verificar(salida, tieneAlfa, false);
  return {
    buffer: salida,
    contentType: 'image/webp',
    ext: 'webp',
    ancho: v.ancho,
    alto: v.alto,
    tieneAlfa: v.tieneAlfa,
    animada: false,
    hash: hashDe(salida),
  };
}

/**
 * Se vuelve a abrir lo generado: si no decodifica o perdió la transparencia,
 * no se publica. Es barato (solo cabecera + estadísticas) y es lo que permite
 * prometer «lo que queda en el bucket se ve».
 */
async function verificar(
  buf: Buffer,
  debeTenerAlfa: boolean,
  animada: boolean,
): Promise<{ ancho: number; alto: number; tieneAlfa: boolean }> {
  try {
    const m = await sharp(buf, { failOn: 'error', animated: animada }).metadata();
    const ancho = m.width ?? 0;
    const alto = animada ? (m.pageHeight ?? m.height ?? 0) : (m.height ?? 0);
    if (!ancho || !alto) throw new Error('sin dimensiones');
    const tieneAlfa = m.hasAlpha === true;
    if (debeTenerAlfa && !tieneAlfa) throw new Error('se perdió la transparencia');
    return { ancho, alto, tieneAlfa };
  } catch (e: any) {
    throw new ArchivoRechazado(
      `No pudimos procesar la imagen (${e?.message ?? 'error interno'}). No se publicó nada; inténtalo de nuevo o selecciona otra.`,
      'procesamiento',
    );
  }
}

function rechazoDeSharp(e: any): ArchivoRechazado {
  const msg = String(e?.message ?? e ?? '');
  if (/pixel limit|exceeds pixel/i.test(msg)) {
    return new ArchivoRechazado(
      'La imagen tiene demasiados píxeles para procesarla. Redúcela o selecciona otra.',
      'megapixeles',
    );
  }
  return new ArchivoRechazado(
    'No pudimos leer la imagen: el archivo parece dañado o incompleto. Ábrelo en tu equipo, ' +
      'guárdalo de nuevo como JPG o PNG y vuelve a subirlo.',
    'corrupto',
  );
}
