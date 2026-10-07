/**
 * POLÍTICA ÚNICA DE ARCHIVOS, POR USO DEL RECURSO.
 *
 * Por qué por USO y no por extensión: un PNG de 3 MB es razonable como página
 * de un menú libro y absurdo como sello de 14 px. Hasta 2026-10 la única regla
 * era «15 MB si es imagen, 25 si la carpeta es menu-book», así que se
 * publicaban logos de 3 MB pintados en una caja de 260×140 y banners PNG de
 * 1,97 MB que eran el LCP del menú (auditoría 2026-10-07).
 *
 * Reglas que fija este archivo:
 *  - Los pesos van en unidades DECIMALES (1 MB = 1.000.000 bytes): es lo que
 *    muestra el explorador de Windows/macOS y el teléfono. Con 1024 un archivo
 *    que el sistema dice «8,1 MB» pasaba un tope de «8 MB» y el negocio no
 *    entendía por qué otro de «8,3» no.
 *  - `maxBytesOriginal` es el tope de lo que se TRANSMITE. Lo que se publica es
 *    el «maestro» que genera el servidor (reorientado, sin metadatos, reducido
 *    a `ladoMaestro`), nunca el original.
 *  - `presupuestoPublico` es un OBJETIVO para la versión que ve el cliente a
 *    `anchoReferencia`, no un tope duro: no se sacrifica la legibilidad de
 *    textos y precios para cumplirlo. La simulación de la migración lo mide.
 *  - Las variantes responsivas (`anchosVariantes`) NO se guardan en el bucket:
 *    las sirve el optimizador de Vercel (`/_next/image`) a partir del maestro,
 *    con caché de un año (ver `next.config.js`). Solo se guardan
 *    (`variantesGuardadas`) las que se consumen donde no hay optimizador o
 *    donde pedirle 30 transformaciones por carta sería caro: las miniaturas
 *    del menú libro.
 *  - Los anchos de variante son SOLO los que el optimizador acepta
 *    (`deviceSizes` 640…3840 e `imageSizes` 16…384 por defecto): cualquier
 *    otro responde 400 y la imagen sale EN BLANCO. Por eso 320 → 384 y
 *    960 → 828/1080 respecto a la propuesta inicial.
 *
 * Hay un espejo para el navegador en `frontend/src/lib/politica-de-archivos.mjs`
 * y una prueba (`frontend/scripts/pruebas-politica-de-archivos.mjs`) que lee el
 * bloque marcado abajo y falla si los dos divergen. El bloque entre las marcas
 * tiene que seguir siendo un literal de objeto evaluable (números, cadenas,
 * listas y las constantes `MB`/`KB`).
 */

export const MB = 1_000_000;
export const KB = 1_000;

export type FormatoDeImagen = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif';
export type FormatoDetectado =
  | FormatoDeImagen
  | 'heic'
  | 'pdf'
  | 'svg'
  | 'mp4'
  | 'webm'
  | 'mp3'
  | 'wav'
  | 'ogg'
  | 'desconocido';

export type Uso =
  | 'PRODUCTO'
  | 'PORTADA'
  | 'BANNER'
  | 'FONDO'
  | 'LOGO'
  | 'ICONO'
  | 'SELLO'
  | 'PAGINA_LIBRO'
  | 'MINIATURA_LIBRO'
  | 'PDF_MENU'
  | 'AVISO_EMERGENTE'
  | 'INFOLINK'
  | 'PROMOCION'
  | 'TARJETA_WALLET'
  | 'IMAGEN_CORREO'
  | 'DIAPOSITIVA'
  | 'CARTEL_QR'
  | 'ADJUNTO'
  | 'GENERAL';

/**
 * `webp`: el maestro sale en WebP (con alfa si la tiene). Para lo que solo se
 * ve en la web, detrás del optimizador.
 * `compatible`: PNG si hay transparencia, JPEG si no. Para lo que consumen
 * terceros con la URL directa: Google Wallet (`sourceUri`), los clientes de
 * correo (Outlook no pinta WebP) y el logo, que acaba en los dos.
 */
export type FormatoMaestro = 'webp' | 'compatible';

export interface PoliticaDeImagen {
  tipo: 'imagen';
  /** Plural en español para los mensajes: «el máximo permitido para banners». */
  etiqueta: string;
  maxBytesOriginal: number;
  presupuestoPublico: number;
  anchoReferencia: number;
  /** Segundo presupuesto para la vista ampliada (la ficha del producto). */
  presupuestoAmpliado?: number;
  anchoAmpliado?: number;
  anchosVariantes: number[];
  variantesGuardadas: number[];
  /** Presupuesto de cada variante guardada (miniaturas). */
  presupuestoVariante: number;
  ladoMaestro: number;
  /** Lado máximo que se ACEPTA del original (más es casi seguro un error). */
  ladoMaximoOriginal: number;
  /** Tope de megapíxeles: también es el `limitInputPixels` de sharp. */
  maxMegapixeles: number;
  calidad: number;
  /** Calidad más baja a la que se baja una variante guardada para entrar en su presupuesto. */
  calidadMinima: number;
  formatos: FormatoDeImagen[];
  formatoMaestro: FormatoMaestro;
  conservarAlfa: boolean;
  admiteAnimacion: boolean;
  archivosPorLote: number;
  /** El navegador recorta (canvas) antes de transmitir: el tope se aplica al recorte. */
  recortaEnNavegador: boolean;
}

export interface PoliticaDePdf {
  tipo: 'pdf';
  etiqueta: string;
  maxBytesOriginal: number;
  paginasMaximas: number;
  /** Uso con el que se procesa cada página. */
  usoDePagina: 'PAGINA_LIBRO';
  /** Ancho al que se rasteriza cada página antes de optimizarla. */
  anchoDeRender: number;
  tiempoMaximoMs: number;
  tiempoPorPaginaMs: number;
  /** Importaciones simultáneas por instancia: rasterizar es CPU y memoria. */
  concurrencia: number;
  archivosPorLote: number;
}

export interface PoliticaDeAdjunto {
  tipo: 'adjunto';
  etiqueta: string;
  /** Topes por categoría; las imágenes además pasan por `GENERAL`. */
  maxBytesImagen: number;
  maxBytesDocumento: number;
  maxBytesAudio: number;
  maxBytesVideo: number;
  archivosPorLote: number;
}

export type Politica = PoliticaDeImagen | PoliticaDePdf | PoliticaDeAdjunto;

// <politica:inicio>
const FOTO: FormatoDeImagen[] = ['jpeg', 'png', 'webp', 'avif'];
const FOTO_Y_GIF: FormatoDeImagen[] = ['jpeg', 'png', 'webp', 'avif', 'gif'];

// Valores comunes de una imagen; cada uso pisa lo suyo.
const BASE = {
  tipo: 'imagen' as const,
  variantesGuardadas: [] as number[],
  presupuestoVariante: 0,
  ladoMaximoOriginal: 12_000,
  maxMegapixeles: 50,
  calidadMinima: 60,
  conservarAlfa: true,
  archivosPorLote: 1,
  recortaEnNavegador: false,
};

export const POLITICA = {
  PRODUCTO: {
    ...BASE,
    etiqueta: 'fotos de producto',
    // Inventario 2026-10-07: p99 de los originales = 2,6 MB. 3 MB deja pasar
    // cualquier foto real; lo que viene del recortador pesa mucho menos.
    maxBytesOriginal: 3 * MB,
    // Tarjeta del listado (~200 px a 2x → 384).
    presupuestoPublico: 60 * KB,
    anchoReferencia: 384,
    // Ficha del producto (~400 px a 2x → 828).
    presupuestoAmpliado: 150 * KB,
    anchoAmpliado: 828,
    anchosVariantes: [384, 640, 828],
    ladoMaestro: 1600,
    calidad: 82,
    formatos: FOTO_Y_GIF,
    formatoMaestro: 'webp',
    admiteAnimacion: true,
    recortaEnNavegador: true,
  },
  PORTADA: {
    ...BASE,
    etiqueta: 'portadas',
    maxBytesOriginal: 8 * MB,
    presupuestoPublico: 150 * KB,
    anchoReferencia: 1080,
    anchosVariantes: [640, 828, 1080, 1200],
    ladoMaestro: 2048,
    calidad: 80,
    formatos: FOTO_Y_GIF,
    formatoMaestro: 'webp',
    admiteAnimacion: true,
  },
  BANNER: {
    ...BASE,
    etiqueta: 'banners',
    maxBytesOriginal: 8 * MB,
    presupuestoPublico: 150 * KB,
    // 828 q70 deja el p90 del inventario en 115 KB; detrás hay un degradado.
    anchoReferencia: 828,
    anchosVariantes: [640, 828, 1080],
    ladoMaestro: 2048,
    calidad: 80,
    formatos: FOTO,
    formatoMaestro: 'webp',
    admiteAnimacion: false,
  },
  FONDO: {
    ...BASE,
    etiqueta: 'fondos',
    maxBytesOriginal: 8 * MB,
    presupuestoPublico: 150 * KB,
    anchoReferencia: 828,
    anchosVariantes: [640, 828, 1080],
    ladoMaestro: 2048,
    calidad: 75,
    formatos: FOTO,
    formatoMaestro: 'webp',
    admiteAnimacion: false,
  },
  LOGO: {
    ...BASE,
    etiqueta: 'logos',
    maxBytesOriginal: 2 * MB,
    presupuestoPublico: 50 * KB,
    // Caja de 260×140: 384 sobra para un logo cuadrado o alto (p50 13 KB) y
    // 750 para uno apaisado. Hoy se pide a 828 (p90 184 KB).
    anchoReferencia: 384,
    anchosVariantes: [256, 384, 750],
    ladoMaestro: 1024,
    calidad: 90,
    formatos: FOTO,
    formatoMaestro: 'compatible',
    admiteAnimacion: false,
  },
  ICONO: {
    ...BASE,
    etiqueta: 'iconos',
    maxBytesOriginal: 1 * MB,
    presupuestoPublico: 5 * KB,
    anchoReferencia: 64,
    anchosVariantes: [32, 64],
    ladoMaestro: 256,
    ladoMaximoOriginal: 4096,
    maxMegapixeles: 16,
    calidad: 90,
    formatos: FOTO,
    formatoMaestro: 'webp',
    admiteAnimacion: false,
  },
  SELLO: {
    ...BASE,
    etiqueta: 'sellos',
    maxBytesOriginal: 1 * MB,
    // 64 px a q85 = 1,8 KB medido; el sello de marca hoy baja 225 KB crudo.
    presupuestoPublico: 5 * KB,
    anchoReferencia: 64,
    anchosVariantes: [32, 64],
    ladoMaestro: 256,
    ladoMaximoOriginal: 4096,
    maxMegapixeles: 16,
    calidad: 85,
    formatos: FOTO,
    formatoMaestro: 'compatible',
    admiteAnimacion: false,
  },
  PAGINA_LIBRO: {
    ...BASE,
    etiqueta: 'páginas del menú libro',
    maxBytesOriginal: 15 * MB,
    // Una hoja de 1440×2560 con texto: 200 KB obligaba a perder nitidez en
    // los precios. El inventario pide p90 ≤ 300 KB a 1080.
    presupuestoPublico: 300 * KB,
    anchoReferencia: 1080,
    anchosVariantes: [640, 828, 1080, 1200, 1920, 2048],
    variantesGuardadas: [80, 160],
    presupuestoVariante: 15 * KB,
    ladoMaestro: 2560,
    calidad: 85,
    formatos: FOTO,
    formatoMaestro: 'webp',
    admiteAnimacion: false,
    archivosPorLote: 60,
  },
  MINIATURA_LIBRO: {
    ...BASE,
    etiqueta: 'miniaturas del menú libro',
    maxBytesOriginal: 1 * MB,
    presupuestoPublico: 15 * KB,
    anchoReferencia: 160,
    anchosVariantes: [],
    variantesGuardadas: [80, 160],
    presupuestoVariante: 15 * KB,
    ladoMaestro: 160,
    calidad: 70,
    calidadMinima: 45,
    formatos: FOTO,
    formatoMaestro: 'webp',
    admiteAnimacion: false,
  },
  PDF_MENU: {
    tipo: 'pdf',
    etiqueta: 'PDF del menú',
    maxBytesOriginal: 20 * MB,
    paginasMaximas: 40,
    usoDePagina: 'PAGINA_LIBRO',
    anchoDeRender: 2048,
    tiempoMaximoMs: 150_000,
    tiempoPorPaginaMs: 20_000,
    concurrencia: 1,
    archivosPorLote: 1,
  },
  AVISO_EMERGENTE: {
    ...BASE,
    etiqueta: 'avisos emergentes',
    maxBytesOriginal: 5 * MB,
    presupuestoPublico: 120 * KB,
    anchoReferencia: 828,
    anchosVariantes: [640, 828, 1080, 1200],
    ladoMaestro: 2048,
    calidad: 85,
    formatos: FOTO_Y_GIF,
    formatoMaestro: 'webp',
    admiteAnimacion: true,
  },
  INFOLINK: {
    ...BASE,
    etiqueta: 'imágenes del InfoLink',
    maxBytesOriginal: 8 * MB,
    presupuestoPublico: 150 * KB,
    anchoReferencia: 1080,
    anchosVariantes: [640, 1080],
    ladoMaestro: 2048,
    calidad: 82,
    formatos: FOTO_Y_GIF,
    formatoMaestro: 'webp',
    admiteAnimacion: true,
  },
  PROMOCION: {
    ...BASE,
    etiqueta: 'imágenes de promociones',
    maxBytesOriginal: 5 * MB,
    presupuestoPublico: 120 * KB,
    anchoReferencia: 1080,
    anchosVariantes: [640, 1080],
    ladoMaestro: 2048,
    calidad: 82,
    formatos: FOTO_Y_GIF,
    formatoMaestro: 'webp',
    admiteAnimacion: true,
  },
  TARJETA_WALLET: {
    ...BASE,
    etiqueta: 'imágenes de la tarjeta',
    maxBytesOriginal: 5 * MB,
    presupuestoPublico: 200 * KB,
    anchoReferencia: 1125,
    anchosVariantes: [],
    ladoMaestro: 2048,
    calidad: 85,
    formatos: FOTO,
    formatoMaestro: 'compatible',
    admiteAnimacion: false,
  },
  IMAGEN_CORREO: {
    ...BASE,
    etiqueta: 'imágenes de correo',
    maxBytesOriginal: 5 * MB,
    presupuestoPublico: 200 * KB,
    anchoReferencia: 1200,
    anchosVariantes: [],
    ladoMaestro: 1200,
    calidad: 82,
    formatos: FOTO_Y_GIF,
    formatoMaestro: 'compatible',
    admiteAnimacion: true,
  },
  DIAPOSITIVA: {
    ...BASE,
    etiqueta: 'diapositivas',
    maxBytesOriginal: 15 * MB,
    presupuestoPublico: 300 * KB,
    anchoReferencia: 1920,
    anchosVariantes: [1080, 1920, 2048],
    ladoMaestro: 2560,
    calidad: 88,
    formatos: FOTO_Y_GIF,
    formatoMaestro: 'webp',
    admiteAnimacion: true,
  },
  CARTEL_QR: {
    ...BASE,
    etiqueta: 'imágenes del cartel QR',
    maxBytesOriginal: 5 * MB,
    presupuestoPublico: 300 * KB,
    anchoReferencia: 2048,
    anchosVariantes: [],
    ladoMaestro: 3000,
    calidad: 90,
    formatos: FOTO,
    formatoMaestro: 'compatible',
    admiteAnimacion: false,
  },
  GENERAL: {
    ...BASE,
    etiqueta: 'imágenes',
    maxBytesOriginal: 15 * MB,
    presupuestoPublico: 300 * KB,
    anchoReferencia: 1920,
    anchosVariantes: [],
    ladoMaestro: 2560,
    calidad: 88,
    formatos: FOTO_Y_GIF,
    formatoMaestro: 'webp',
    admiteAnimacion: true,
  },
  ADJUNTO: {
    tipo: 'adjunto',
    etiqueta: 'adjuntos',
    maxBytesImagen: 15 * MB,
    maxBytesDocumento: 30 * MB,
    maxBytesAudio: 50 * MB,
    maxBytesVideo: 100 * MB,
    archivosPorLote: 1,
  },
} satisfies Record<Uso, Politica>;
// <politica:fin>

/**
 * Carpeta (`?folder=` de siempre) → uso. Existe para que TODO cliente que aún
 * no manda `uso` —el frontend viejo durante el despliegue, o cualquier
 * integración— quede igualmente bajo la política. Una carpeta que no está aquí
 * cae en `ADJUNTO` (imágenes con las reglas de `GENERAL`; PDF, audio y video
 * con sus topes): nunca sin reglas.
 */
// <carpetas:inicio>
export const USO_POR_CARPETA: Record<string, Uso> = {
  products: 'PRODUCTO',
  allies: 'PRODUCTO',
  sections: 'PORTADA',
  covers: 'PORTADA',
  'reservations/events': 'PORTADA',
  'storefront-bg': 'FONDO',
  logos: 'LOGO',
  branding: 'LOGO',
  'wallet-logos': 'LOGO',
  'push-logos': 'LOGO',
  'info-pages': 'LOGO',
  'info-link-icons': 'ICONO',
  'card-stamp-icon': 'SELLO',
  'menu-book': 'PAGINA_LIBRO',
  'menu-book-popup': 'AVISO_EMERGENTE',
  'category-popup': 'AVISO_EMERGENTE',
  'storefront-popup': 'AVISO_EMERGENTE',
  'info-links': 'INFOLINK',
  promotions: 'PROMOCION',
  'card-hero': 'TARJETA_WALLET',
  'card-stamp-bg': 'TARJETA_WALLET',
  'email-templates': 'IMAGEN_CORREO',
  slides: 'DIAPOSITIVA',
  industries: 'DIAPOSITIVA',
  'qr-posters': 'CARTEL_QR',
  'crm-buttons': 'ADJUNTO',
  'crm-attachments': 'ADJUNTO',
  'sequences-attachments': 'ADJUNTO',
  'support-materials': 'ADJUNTO',
  'payout-proofs': 'ADJUNTO',
  payouts: 'ADJUNTO',
  'data-policy': 'ADJUNTO',
  comprobantes: 'ADJUNTO',
  lab: 'ADJUNTO',
};
// <carpetas:fin>

/** Carpeta por defecto de cada uso cuando el cliente manda solo `uso`. */
export const CARPETA_POR_USO: Record<Uso, string> = {
  PRODUCTO: 'products',
  PORTADA: 'sections',
  BANNER: 'banners',
  FONDO: 'storefront-bg',
  LOGO: 'logos',
  ICONO: 'info-link-icons',
  SELLO: 'card-stamp-icon',
  PAGINA_LIBRO: 'menu-book',
  MINIATURA_LIBRO: 'menu-book',
  PDF_MENU: 'menu-book',
  AVISO_EMERGENTE: 'popups',
  INFOLINK: 'info-links',
  PROMOCION: 'promotions',
  TARJETA_WALLET: 'card-hero',
  IMAGEN_CORREO: 'email-templates',
  DIAPOSITIVA: 'slides',
  CARTEL_QR: 'qr-posters',
  ADJUNTO: 'attachments',
  GENERAL: 'uploads',
};

export function esUso(v: unknown): v is Uso {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(POLITICA, v);
}

/**
 * Resuelve el uso de una subida. Manda `uso` si viene y es válido; si no, la
 * carpeta. `null` si el `uso` vino pero no existe: es un error del cliente y
 * se rechaza, en vez de adivinar.
 */
export function resolverUso(opts: { uso?: string | null; folder?: string | null }): Uso | null {
  const u = (opts.uso ?? '').trim().toUpperCase();
  if (u) return esUso(u) ? u : null;
  const f = (opts.folder ?? '').trim();
  // Carpeta desconocida → ADJUNTO, que admite imagen (procesada con GENERAL),
  // PDF, audio y video con sus topes: así una carpeta nueva no rompe un flujo
  // que ya sube videos, pero tampoco queda sin reglas.
  return USO_POR_CARPETA[f] ?? 'ADJUNTO';
}

export function politicaDe(uso: Uso): Politica {
  return POLITICA[uso] as Politica;
}

/**
 * «9,2 MB», «850 KB», «8 MB». En decimal y con coma, como lo escribe un
 * colombiano; sin decimales cuando es exacto («8 MB», no «8,0 MB»).
 */
export function pesoLegible(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const fmt = (n: number) => {
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
  };
  if (bytes >= MB) return `${fmt(bytes / MB)} MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`;
  return `${bytes} B`;
}

/** El mensaje exacto que ve el negocio cuando un archivo pasa del tope. */
export function mensajeDePesoExcedido(opts: {
  bytes: number;
  maximo: number;
  etiqueta: string;
  esImagen?: boolean;
}): string {
  const que = opts.esImagen === false ? 'Este archivo' : 'Esta imagen';
  const otra = opts.esImagen === false ? 'otro archivo' : 'otra imagen';
  return (
    `${que} pesa ${pesoLegible(opts.bytes)}. ` +
    `El máximo permitido para ${opts.etiqueta} es ${pesoLegible(opts.maximo)}. ` +
    `Reduce su tamaño o selecciona ${otra}.`
  );
}

const NOMBRE_DE_FORMATO: Record<FormatoDeImagen, string> = {
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  gif: 'GIF',
  avif: 'AVIF',
};

/** «JPG, PNG, WebP o AVIF». */
export function formatosLegibles(formatos: readonly FormatoDeImagen[]): string {
  const n = formatos.map((f) => NOMBRE_DE_FORMATO[f]);
  if (n.length <= 1) return n.join('');
  return `${n.slice(0, -1).join(', ')} o ${n[n.length - 1]}`;
}

/** El mayor tope de transmisión de cualquier uso: es el límite de multer. */
export const MAX_BYTES_TRANSMISION = Math.max(
  ...Object.values(POLITICA as Record<string, Politica>).map((p) =>
    p.tipo === 'adjunto' ? p.maxBytesVideo : p.maxBytesOriginal,
  ),
);
