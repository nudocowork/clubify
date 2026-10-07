/**
 * Espejo, para el NAVEGADOR, de `backend/src/media/politica-de-archivos.ts`.
 *
 * Por qué existe: comprobar el peso ANTES de transmitir. Un banner de 9 MB por
 * el wifi de un local tarda un minuto en subir para que el servidor lo rechace
 * al final; aquí se rechaza al elegirlo, con el mismo mensaje que daría el
 * servidor. El servidor vuelve a validarlo todo: esto es comodidad, no candado.
 *
 * Solo lleva lo que el navegador necesita. Cada campo que está aquí tiene que
 * valer EXACTAMENTE lo mismo que en el backend: lo vigila
 * `node scripts/pruebas-politica-de-archivos.mjs`, que lee el bloque marcado
 * del archivo del backend y falla si divergen.
 */

export const MB = 1_000_000;
export const KB = 1_000;

const FOTO = ['jpeg', 'png', 'webp', 'avif'];
const FOTO_Y_GIF = ['jpeg', 'png', 'webp', 'avif', 'gif'];

const img = (o) => Object.freeze({ tipo: 'imagen', recortaEnNavegador: false, archivosPorLote: 1, ladoMaximoOriginal: 12_000, maxMegapixeles: 50, variantesGuardadas: [], ...o });

export const POLITICA = Object.freeze({
  PRODUCTO: img({ etiqueta: 'fotos de producto', maxBytesOriginal: 3 * MB, ladoMaestro: 1600, formatos: FOTO_Y_GIF, admiteAnimacion: true, recortaEnNavegador: true, anchosVariantes: [384, 640, 828] }),
  PORTADA: img({ etiqueta: 'portadas', maxBytesOriginal: 8 * MB, ladoMaestro: 2048, formatos: FOTO_Y_GIF, admiteAnimacion: true, anchosVariantes: [640, 828, 1080, 1200] }),
  BANNER: img({ etiqueta: 'banners', maxBytesOriginal: 8 * MB, ladoMaestro: 2048, formatos: FOTO, admiteAnimacion: false, anchosVariantes: [640, 828, 1080] }),
  FONDO: img({ etiqueta: 'fondos', maxBytesOriginal: 8 * MB, ladoMaestro: 2048, formatos: FOTO, admiteAnimacion: false, anchosVariantes: [640, 828, 1080] }),
  LOGO: img({ etiqueta: 'logos', maxBytesOriginal: 2 * MB, ladoMaestro: 1024, formatos: FOTO, admiteAnimacion: false, anchosVariantes: [256, 384, 750] }),
  ICONO: img({ etiqueta: 'iconos', maxBytesOriginal: 1 * MB, ladoMaestro: 256, ladoMaximoOriginal: 4096, maxMegapixeles: 16, formatos: FOTO, admiteAnimacion: false, anchosVariantes: [32, 64] }),
  SELLO: img({ etiqueta: 'sellos', maxBytesOriginal: 1 * MB, ladoMaestro: 256, ladoMaximoOriginal: 4096, maxMegapixeles: 16, formatos: FOTO, admiteAnimacion: false, anchosVariantes: [32, 64] }),
  PAGINA_LIBRO: img({ etiqueta: 'páginas del menú libro', maxBytesOriginal: 15 * MB, ladoMaestro: 2560, formatos: FOTO, admiteAnimacion: false, archivosPorLote: 60, anchosVariantes: [640, 828, 1080, 1200, 1920, 2048], variantesGuardadas: [80, 160] }),
  MINIATURA_LIBRO: img({ etiqueta: 'miniaturas del menú libro', maxBytesOriginal: 1 * MB, ladoMaestro: 160, formatos: FOTO, admiteAnimacion: false, anchosVariantes: [], variantesGuardadas: [80, 160] }),
  PDF_MENU: Object.freeze({ tipo: 'pdf', etiqueta: 'PDF del menú', maxBytesOriginal: 20 * MB, paginasMaximas: 40, archivosPorLote: 1 }),
  AVISO_EMERGENTE: img({ etiqueta: 'avisos emergentes', maxBytesOriginal: 5 * MB, ladoMaestro: 2048, formatos: FOTO_Y_GIF, admiteAnimacion: true, anchosVariantes: [640, 828, 1080, 1200] }),
  INFOLINK: img({ etiqueta: 'imágenes del InfoLink', maxBytesOriginal: 8 * MB, ladoMaestro: 2048, formatos: FOTO_Y_GIF, admiteAnimacion: true, anchosVariantes: [640, 1080] }),
  PROMOCION: img({ etiqueta: 'imágenes de promociones', maxBytesOriginal: 5 * MB, ladoMaestro: 2048, formatos: FOTO_Y_GIF, admiteAnimacion: true, anchosVariantes: [640, 1080] }),
  TARJETA_WALLET: img({ etiqueta: 'imágenes de la tarjeta', maxBytesOriginal: 5 * MB, ladoMaestro: 2048, formatos: FOTO, admiteAnimacion: false, anchosVariantes: [] }),
  IMAGEN_CORREO: img({ etiqueta: 'imágenes de correo', maxBytesOriginal: 5 * MB, ladoMaestro: 1200, formatos: FOTO_Y_GIF, admiteAnimacion: true, anchosVariantes: [] }),
  DIAPOSITIVA: img({ etiqueta: 'diapositivas', maxBytesOriginal: 15 * MB, ladoMaestro: 2560, formatos: FOTO_Y_GIF, admiteAnimacion: true, anchosVariantes: [1080, 1920, 2048] }),
  CARTEL_QR: img({ etiqueta: 'imágenes del cartel QR', maxBytesOriginal: 5 * MB, ladoMaestro: 3000, formatos: FOTO, admiteAnimacion: false, anchosVariantes: [] }),
  GENERAL: img({ etiqueta: 'imágenes', maxBytesOriginal: 15 * MB, ladoMaestro: 2560, formatos: FOTO_Y_GIF, admiteAnimacion: true, anchosVariantes: [] }),
  ADJUNTO: Object.freeze({ tipo: 'adjunto', etiqueta: 'adjuntos', maxBytesImagen: 15 * MB, maxBytesDocumento: 30 * MB, maxBytesAudio: 50 * MB, maxBytesVideo: 100 * MB, archivosPorLote: 1 }),
});

/** Igual que `USO_POR_CARPETA` del backend (la prueba lo compara). */
export const USO_POR_CARPETA = Object.freeze({
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
});

/** El uso de una carpeta (lo que hace el servidor si no le llega `uso`). */
export function usoDeCarpeta(folder) {
  return USO_POR_CARPETA[String(folder ?? '').trim()] ?? 'ADJUNTO';
}

const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
const NOMBRE = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', gif: 'GIF', avif: 'AVIF' };

/** «9,2 MB», «850 KB», «8 MB» — idéntico a `pesoLegible` del backend. */
export function pesoLegible(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const fmt = (n) => {
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
  };
  if (bytes >= MB) return `${fmt(bytes / MB)} MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`;
  return `${bytes} B`;
}

/** El mismo texto que devuelve el servidor (lo compara la prueba). */
export function mensajeDePesoExcedido({ bytes, maximo, etiqueta, esImagen = true }) {
  const que = esImagen === false ? 'Este archivo' : 'Esta imagen';
  const otra = esImagen === false ? 'otro archivo' : 'otra imagen';
  return (
    `${que} pesa ${pesoLegible(bytes)}. ` +
    `El máximo permitido para ${etiqueta} es ${pesoLegible(maximo)}. ` +
    `Reduce su tamaño o selecciona ${otra}.`
  );
}

export function formatosLegibles(formatos) {
  const n = formatos.map((f) => NOMBRE[f]);
  if (n.length <= 1) return n.join('');
  return `${n.slice(0, -1).join(', ')} o ${n[n.length - 1]}`;
}

/** Valor del atributo `accept` del `<input type="file">` para un uso. */
export function aceptarDe(uso) {
  const p = POLITICA[uso];
  if (!p) return 'image/*';
  if (p.tipo === 'pdf') return 'application/pdf';
  if (p.tipo === 'adjunto') return '';
  return p.formatos.map((f) => MIME[f]).join(',');
}

/** «JPG, PNG, WebP o AVIF · máx. 8 MB» — lo que se muestra junto al campo. */
export function textoDeAyuda(uso) {
  const p = POLITICA[uso];
  if (!p) return '';
  if (p.tipo === 'pdf') return `PDF · máx. ${pesoLegible(p.maxBytesOriginal)} · hasta ${p.paginasMaximas} páginas`;
  if (p.tipo === 'adjunto') return `máx. ${pesoLegible(p.maxBytesVideo)}`;
  return `${formatosLegibles(p.formatos)} · máx. ${pesoLegible(p.maxBytesOriginal)}`;
}

/**
 * Comprueba un archivo ANTES de subirlo. Devuelve el mensaje para el negocio,
 * o `null` si puede subirse. Recibe `{ size, type, name }` (un `File`).
 *
 * `trasRecortar`: el recortador ya re-codificó la imagen en el navegador (lo
 * que se transmite es el recorte), así que el peso que cuenta es el del recorte.
 */
export function validarArchivo(file, uso, { trasRecortar = false } = {}) {
  const p = POLITICA[uso];
  if (!file || !p) return null;
  const tipo = String(file.type || '').toLowerCase();
  const nombre = String(file.name || '').toLowerCase();
  if (p.tipo === 'pdf') {
    if (tipo !== 'application/pdf' && !nombre.endsWith('.pdf')) return 'Selecciona un archivo PDF.';
    if (file.size > p.maxBytesOriginal) {
      return mensajeDePesoExcedido({ bytes: file.size, maximo: p.maxBytesOriginal, etiqueta: p.etiqueta, esImagen: false });
    }
    return null;
  }
  if (p.tipo === 'adjunto') {
    const max = tipo.startsWith('video/')
      ? p.maxBytesVideo
      : tipo.startsWith('audio/')
        ? p.maxBytesAudio
        : tipo === 'application/pdf'
          ? p.maxBytesDocumento
          : p.maxBytesImagen;
    if (file.size > max) {
      return mensajeDePesoExcedido({ bytes: file.size, maximo: max, etiqueta: p.etiqueta, esImagen: tipo.startsWith('image/') });
    }
    return null;
  }
  if (tipo === 'image/heic' || tipo === 'image/heif' || /\.(heic|heif)$/.test(nombre)) {
    return 'Esta foto está en formato HEIC (el de los iPhone) y no se puede publicar así. Expórtala como JPG o, en el iPhone, ve a Ajustes › Cámara › Formatos y elige «Más compatible».';
  }
  const aceptados = p.formatos.map((f) => MIME[f]);
  // Algunos navegadores no informan el tipo (queda ''): decide el servidor.
  if (tipo && !aceptados.includes(tipo)) {
    return `Formato no admitido. Para ${p.etiqueta} se aceptan ${formatosLegibles(p.formatos)}.`;
  }
  // El recortador permite elegir una foto pesada: el tope aplica al recorte.
  if (p.recortaEnNavegador && !trasRecortar) return null;
  if (file.size > p.maxBytesOriginal) {
    return mensajeDePesoExcedido({ bytes: file.size, maximo: p.maxBytesOriginal, etiqueta: p.etiqueta });
  }
  return null;
}

/** Dimensiones fuera de política (ya medidas en el navegador), o `null`. */
export function validarDimensiones(ancho, alto, uso) {
  const p = POLITICA[uso];
  if (!p || p.tipo !== 'imagen' || !ancho || !alto) return null;
  if (Math.max(ancho, alto) > p.ladoMaximoOriginal) {
    return `La imagen mide ${ancho} × ${alto} px. El máximo para ${p.etiqueta} es ${p.ladoMaximoOriginal} px por lado. Redúcela o selecciona otra.`;
  }
  if (ancho * alto > p.maxMegapixeles * 1_000_000) {
    return `La imagen tiene demasiados píxeles (${Math.round((ancho * alto) / 1e6)} megapíxeles). El máximo para ${p.etiqueta} es ${p.maxMegapixeles}. Redúcela o selecciona otra.`;
  }
  return null;
}

/**
 * Miniatura guardada de una página del libro, deducida de la URL del maestro.
 *
 * Las páginas subidas (o migradas) con la política nueva se llaman
 * `<hash de 20 hex>.<ext>` y llevan al lado `<hash>.w80.webp` y
 * `<hash>.w160.webp`. Una URL vieja (nanoid de 16) no tiene miniaturas
 * guardadas: devuelve `null` y quien la pinte sigue con el optimizador. Así no
 * hace falta columna nueva en la base, y nunca se pide una miniatura que no
 * existe.
 */
export function miniaturaGuardada(url, ancho) {
  if (typeof url !== 'string' || !(ancho === 80 || ancho === 160)) return null;
  const m = /^(https?:\/\/[^?#]+\/[0-9a-f]{20})\.(webp|png|jpg|gif)$/i.exec(url.trim());
  return m ? `${m[1]}.w${ancho}.webp` : null;
}
