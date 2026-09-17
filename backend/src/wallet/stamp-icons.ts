/**
 * Renderizadores de íconos inline SVG para el strip.png del .pkpass.
 *
 * Por qué inline SVG y no emoji: librsvg (que usa sharp) NO renderiza fuentes
 * de color emoji — sale como silueta negra monocromática aunque
 * fonts-noto-color-emoji esté instalado. Resultado: 🍪 aparecía como mancha
 * negra en Apple Wallet.
 *
 * Estilo "gourmet" (referencia A5 elegida por el usuario):
 *   - Radial gradient en el cuerpo (lighter top-left → darker bottom-right)
 *   - Detalles oscuros para contraste (chocolate chips, líneas, etc.)
 *   - Borde sutil exterior para definición sobre fondo blanco
 *
 * Convención: cada renderer recibe (cx, cy, size, id) y devuelve un fragmento
 * SVG centrado en (cx, cy) con bounding box `size`. El `id` se usa para
 * unicidad de gradientes (varias instancias en el mismo SVG no pueden
 * compartir ID).
 *
 * Para emojis sin mapping → fallback a check ✓ blanco con drop shadow.
 */

import { CacheAcotada } from '../common/cache-acotada';
import { descargarAcotado, esEstadoPasajero } from '../common/descarga-acotada';

type IconRenderer = (cx: number, cy: number, size: number, id: string) => string;

/**
 * Topes de las cachés de iconos.
 *
 * Eran `Map` sin límite, con la clave elegida por quien llama: el emoji y la
 * URL llegan del panel (`POST /cards/preview-strips`) y de lo guardado en cada
 * tarjeta. Y guardaban un fallo PASAJERO como `null` para siempre: un CDN lento
 * dejaba la tarjeta con el ✓ de respaldo hasta el próximo despliegue.
 */
const MAX_ENTRADAS_CACHE_ICONOS = 200;
/** Un fallo de red, 5xx o 429: se reintenta pronto. */
const TTL_FALLO_PASAJERO_MS = 30_000;
/** Un 404 o una imagen que no se deja procesar: no cambia en segundos. */
const TTL_FALLO_DEFINITIVO_MS = 10 * 60_000;
/**
 * El emoji más largo del estándar (pareja con tonos de piel) mide 15 unidades
 * UTF-16. Más de 32 no es un emoji: es texto metido en la URL de Twemoji.
 */
export const MAX_LARGO_EMOJI = 32;
/** Igual que el tope de subida de imágenes del panel (`media.service`). */
const MAX_BYTES_ICONO_PROPIO = 15 * 1024 * 1024;
/** Un PNG 72×72 de Twemoji pesa ~3 KB; el tope solo corta respuestas absurdas. */
const MAX_BYTES_TWEMOJI = 256 * 1024;

/**
 * Bucket del Onboarding (Supabase): las imágenes sincronizadas desde allí viven
 * en su almacenamiento público. Mismo criterio que el proxy de `media`.
 */
const HOST_BUCKET_ONBOARDING = 'ugbqfcogmqkuhhepecfq.supabase.co';

/**
 * ¿Se puede descargar esta URL como icono de sello propio?
 *
 * El servidor descargaba CUALQUIER URL que mandara el cliente, incluidas las
 * internas (metadatos de la nube, `localhost`). Los iconos propios se suben
 * desde el panel a NUESTRO almacenamiento (en producción, las 25 tarjetas con
 * icono propio apuntan al host de `S3_PUBLIC_URL`), así que solo se admite ese
 * host —comparado exacto, no por prefijo: `<bucket>.atacante.com` empieza
 * igual— y el bucket público del Onboarding.
 */
export function urlDeIconoPermitida(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  // Misma base que usa `media.service` para construir las URLs que devuelve.
  const base =
    process.env.S3_PUBLIC_URL ??
    `${process.env.S3_ENDPOINT ?? 'http://localhost:9000'}/${process.env.S3_BUCKET ?? 'clubify-media'}`;
  try {
    const b = new URL(base);
    if (u.protocol === b.protocol && u.host === b.host) return true;
  } catch {
    /* base mal configurada: solo queda el bucket del Onboarding */
  }
  return (
    u.protocol === 'https:' &&
    u.host === HOST_BUCKET_ONBOARDING &&
    u.pathname.startsWith('/storage/v1/object/public/')
  );
}

function clampDefs(): string {
  // No-op: cada renderer define sus propios <linearGradient> / <radialGradient>
  // inline para evitar coordinación con el SVG padre.
  return '';
}

const cookieGourmet: IconRenderer = (cx, cy, size, id) => {
  const scale = size / 64;
  const tx = cx - size / 2;
  const ty = cy - size / 2;
  return `<defs>
    <radialGradient id="cookieG_${id}" cx="40%" cy="35%" r="60%">
      <stop offset="0%" stop-color="#E2B07C"/>
      <stop offset="100%" stop-color="#A26B3C"/>
    </radialGradient>
  </defs>
  <g transform="translate(${tx} ${ty}) scale(${scale})">
    <circle cx="32" cy="32" r="26" fill="url(#cookieG_${id})"/>
    <circle cx="22" cy="24" r="3.2" fill="#2D1810"/>
    <circle cx="40" cy="22" r="2.5" fill="#2D1810"/>
    <circle cx="36" cy="38" r="3" fill="#2D1810"/>
    <circle cx="22" cy="40" r="2.2" fill="#2D1810"/>
    <circle cx="44" cy="34" r="2" fill="#2D1810"/>
    <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(0,0,0,0.18)" stroke-width="1"/>
  </g>`;
};

const coffeeCup: IconRenderer = (cx, cy, size, id) => {
  const scale = size / 64;
  const tx = cx - size / 2;
  const ty = cy - size / 2;
  return `<defs>
    <linearGradient id="cupG_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#F1F1F1"/>
      <stop offset="100%" stop-color="#9CA3AF"/>
    </linearGradient>
    <linearGradient id="coffeeG_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#6F4E37"/>
      <stop offset="100%" stop-color="#3E2C1F"/>
    </linearGradient>
  </defs>
  <g transform="translate(${tx} ${ty}) scale(${scale})">
    <!-- asa -->
    <path d="M46 26 a 8 8 0 0 1 0 14" fill="none" stroke="#6B7280" stroke-width="3.5"/>
    <!-- taza -->
    <path d="M14 22 h 32 v 16 a 12 12 0 0 1 -12 12 h -8 a 12 12 0 0 1 -12 -12 z" fill="url(#cupG_${id})" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>
    <!-- café -->
    <ellipse cx="30" cy="24" rx="14" ry="3" fill="url(#coffeeG_${id})"/>
    <!-- vapor -->
    <path d="M22 12 q 2 -3 0 -6 M30 14 q 2 -4 0 -8 M38 12 q 2 -3 0 -6" fill="none" stroke="rgba(0,0,0,0.30)" stroke-width="1.8" stroke-linecap="round"/>
  </g>`;
};

const starGourmet: IconRenderer = (cx, cy, size, id) => {
  const scale = size / 64;
  const tx = cx - size / 2;
  const ty = cy - size / 2;
  return `<defs>
    <linearGradient id="starG_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FCD34D"/>
      <stop offset="100%" stop-color="#D97706"/>
    </linearGradient>
  </defs>
  <g transform="translate(${tx} ${ty}) scale(${scale})">
    <polygon points="32 6 39.5 24 58 25.5 43.5 38 48 56 32 46.5 16 56 20.5 38 6 25.5 24.5 24" fill="url(#starG_${id})" stroke="rgba(0,0,0,0.20)" stroke-width="1" stroke-linejoin="round"/>
  </g>`;
};

const heartGourmet: IconRenderer = (cx, cy, size, id) => {
  const scale = size / 64;
  const tx = cx - size / 2;
  const ty = cy - size / 2;
  return `<defs>
    <radialGradient id="heartG_${id}" cx="35%" cy="30%" r="65%">
      <stop offset="0%" stop-color="#FB7185"/>
      <stop offset="100%" stop-color="#BE123C"/>
    </radialGradient>
  </defs>
  <g transform="translate(${tx} ${ty}) scale(${scale})">
    <path d="M32 54 C 32 54 8 38 8 22 C 8 14 14 8 22 8 C 27 8 30 11 32 14 C 34 11 37 8 42 8 C 50 8 56 14 56 22 C 56 38 32 54 32 54 Z" fill="url(#heartG_${id})" stroke="rgba(0,0,0,0.20)" stroke-width="1"/>
  </g>`;
};

const croissant: IconRenderer = (cx, cy, size, id) => {
  const scale = size / 64;
  const tx = cx - size / 2;
  const ty = cy - size / 2;
  return `<defs>
    <linearGradient id="croG_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FBBF77"/>
      <stop offset="100%" stop-color="#A4632A"/>
    </linearGradient>
  </defs>
  <g transform="translate(${tx} ${ty}) scale(${scale})">
    <path d="M10 40 Q 14 22 32 18 Q 50 22 54 40 Q 50 46 44 42 Q 42 36 32 34 Q 22 36 20 42 Q 14 46 10 40 Z" fill="url(#croG_${id})" stroke="rgba(0,0,0,0.22)" stroke-width="1.2"/>
    <path d="M22 34 L 26 30 M30 33 L 34 29 M38 34 L 42 30" stroke="rgba(0,0,0,0.20)" stroke-width="1.4" stroke-linecap="round"/>
  </g>`;
};

const burger: IconRenderer = (cx, cy, size, id) => {
  const scale = size / 64;
  const tx = cx - size / 2;
  const ty = cy - size / 2;
  return `<defs>
    <linearGradient id="bunG_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#F8D49B"/>
      <stop offset="100%" stop-color="#B57842"/>
    </linearGradient>
  </defs>
  <g transform="translate(${tx} ${ty}) scale(${scale})">
    <path d="M8 28 Q 10 14 32 14 Q 54 14 56 28 Z" fill="url(#bunG_${id})" stroke="rgba(0,0,0,0.20)" stroke-width="1"/>
    <rect x="8" y="30" width="48" height="4" fill="#9CCC65"/>
    <rect x="8" y="34" width="48" height="6" fill="#8B4513"/>
    <path d="M8 40 Q 10 50 32 50 Q 54 50 56 40 Z" fill="url(#bunG_${id})" stroke="rgba(0,0,0,0.20)" stroke-width="1"/>
    <circle cx="20" cy="22" r="1.2" fill="rgba(255,255,255,0.6)"/>
    <circle cx="32" cy="20" r="1.2" fill="rgba(255,255,255,0.6)"/>
    <circle cx="44" cy="22" r="1.2" fill="rgba(255,255,255,0.6)"/>
  </g>`;
};

const beerMug: IconRenderer = (cx, cy, size, id) => {
  const scale = size / 64;
  const tx = cx - size / 2;
  const ty = cy - size / 2;
  return `<defs>
    <linearGradient id="beerG_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FBBF24"/>
      <stop offset="100%" stop-color="#B45309"/>
    </linearGradient>
  </defs>
  <g transform="translate(${tx} ${ty}) scale(${scale})">
    <path d="M44 24 a 8 8 0 0 1 0 14" fill="none" stroke="#6B7280" stroke-width="3"/>
    <rect x="14" y="20" width="32" height="34" rx="3" fill="url(#beerG_${id})" stroke="rgba(0,0,0,0.22)" stroke-width="1"/>
    <ellipse cx="30" cy="19" rx="16" ry="5" fill="#FFFFFF" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>
    <circle cx="22" cy="16" r="2.2" fill="#FFFFFF"/>
    <circle cx="32" cy="14" r="2.5" fill="#FFFFFF"/>
    <circle cx="40" cy="16" r="2" fill="#FFFFFF"/>
  </g>`;
};

const paw: IconRenderer = (cx, cy, size, id) => {
  const scale = size / 64;
  const tx = cx - size / 2;
  const ty = cy - size / 2;
  return `<g transform="translate(${tx} ${ty}) scale(${scale})">
    <circle cx="18" cy="20" r="6" fill="#3E2723"/>
    <circle cx="32" cy="14" r="6" fill="#3E2723"/>
    <circle cx="46" cy="20" r="6" fill="#3E2723"/>
    <circle cx="12" cy="34" r="5" fill="#3E2723"/>
    <circle cx="52" cy="34" r="5" fill="#3E2723"/>
    <path d="M22 38 Q 32 26 42 38 Q 50 50 32 54 Q 14 50 22 38 Z" fill="#3E2723"/>
  </g>`;
};

const flower: IconRenderer = (cx, cy, size, id) => {
  const scale = size / 64;
  const tx = cx - size / 2;
  const ty = cy - size / 2;
  return `<defs>
    <radialGradient id="petalG_${id}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FBCFE8"/>
      <stop offset="100%" stop-color="#BE185D"/>
    </radialGradient>
  </defs>
  <g transform="translate(${tx} ${ty}) scale(${scale})">
    <ellipse cx="32" cy="14" rx="7" ry="10" fill="url(#petalG_${id})"/>
    <ellipse cx="32" cy="50" rx="7" ry="10" fill="url(#petalG_${id})"/>
    <ellipse cx="14" cy="32" rx="10" ry="7" fill="url(#petalG_${id})"/>
    <ellipse cx="50" cy="32" rx="10" ry="7" fill="url(#petalG_${id})"/>
    <circle cx="32" cy="32" r="7" fill="#FBBF24" stroke="rgba(0,0,0,0.20)" stroke-width="1"/>
  </g>`;
};

const checkFallback: IconRenderer = (cx, cy, size, id) => {
  const scale = size / 64;
  const tx = cx - size / 2;
  const ty = cy - size / 2;
  return `<g transform="translate(${tx} ${ty}) scale(${scale})">
    <polyline points="14 34 26 46 50 18" fill="none" stroke="#16A34A" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
};

const ICON_MAP: Record<string, IconRenderer> = {
  '🍪': cookieGourmet,
  '☕': coffeeCup,
  '⭐': starGourmet,
  '⭐️': starGourmet,
  '★': starGourmet,
  '❤️': heartGourmet,
  '❤': heartGourmet,
  '♥': heartGourmet,
  '🥐': croissant,
  '🍔': burger,
  '🍺': beerMug,
  '🍻': beerMug,
  '🐾': paw,
  '🌸': flower,
  '💐': flower,
  '🌺': flower,
  '✓': checkFallback,
  '✔': checkFallback,
  '✔️': checkFallback,
};

/**
 * Devuelve un fragmento SVG (con <defs> propios + <g> con el ícono) centrado
 * en (cx, cy) con diámetro `size`. Si el emoji no tiene mapping → check ✓.
 */
export function renderStampIconSvg(
  emoji: string,
  cx: number,
  cy: number,
  size: number,
  id: string,
): string {
  const renderer = ICON_MAP[emoji] ?? checkFallback;
  return renderer(cx, cy, size, id);
}

// ¿Hay un renderer SVG "gourmet" dibujado a mano para este emoji?
export function hasCuratedStampIcon(emoji: string): boolean {
  return !!ICON_MAP[emoji];
}

// Convierte un emoji a los codepoints de Twemoji (hex separados por '-',
// sin el variation selector U+FE0F que Twemoji omite en sus nombres de
// archivo). Ej: '🍕' → '1f355', '✂️' → '2702'.
function twemojiCodepoints(emoji: string): string {
  const cps: string[] = [];
  for (const ch of emoji) {
    const cp = ch.codePointAt(0);
    if (cp == null) continue;
    if (cp === 0xfe0f) continue; // variation selector-16: Twemoji lo omite
    cps.push(cp.toString(16));
  }
  return cps.join('-');
}

// Cache en memoria emoji → PNG (o null si no existe en Twemoji). Evita
// re-descargar el mismo emoji en cada generación de strip. Con tope: ver
// MAX_ENTRADAS_CACHE_ICONOS.
const twemojiCache = new CacheAcotada<Buffer | null>({
  maxEntradas: MAX_ENTRADAS_CACHE_ICONOS,
  maxBytes: 8 * 1024 * 1024,
  pesar: (b) => b?.length ?? 0,
});

/**
 * Descarga el PNG color del emoji desde el CDN de Twemoji (jsdelivr). Devuelve
 * el buffer o null si falla / no existe. Cacheado por emoji. Esto permite que
 * CUALQUIER emoji del picker se vea como ícono de sello en el wallet (antes
 * solo ~9 tenían dibujo propio y el resto caía a un check — bug 2026-06-15).
 */
export async function fetchTwemojiPng(emoji: string): Promise<Buffer | null> {
  // Ni se cachea: cada texto distinto sería una entrada más.
  if (!emoji || emoji.length > MAX_LARGO_EMOJI) return null;
  if (twemojiCache.has(emoji)) return twemojiCache.get(emoji) ?? null;
  const code = twemojiCodepoints(emoji);
  if (!code) {
    twemojiCache.set(emoji, null, TTL_FALLO_DEFINITIVO_MS);
    return null;
  }
  const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${code}.png`;
  try {
    // Timeout de 2.5s: este fetch corre DENTRO de la generación del .pkpass
    // (request del cliente). Si el CDN cuelga, degradamos al check fallback en
    // vez de bloquear la descarga del pase.
    const r = await descargarAcotado(url, { timeoutMs: 2500, maxBytes: MAX_BYTES_TWEMOJI });
    if (!r.ok) {
      // 404 = ese emoji no existe en Twemoji (no va a aparecer en un minuto);
      // un 5xx es el CDN con un mal rato y se vuelve a intentar pronto.
      twemojiCache.set(
        emoji,
        null,
        esEstadoPasajero(r.status) ? TTL_FALLO_PASAJERO_MS : TTL_FALLO_DEFINITIVO_MS,
      );
      return null;
    }
    twemojiCache.set(emoji, r.buffer);
    return r.buffer;
  } catch {
    // Red caída o timeout: pasajero. Antes esto quedaba en `null` para siempre.
    twemojiCache.set(emoji, null, TTL_FALLO_PASAJERO_MS);
    return null;
  }
}

/**
 * Resuelve el renderer del ícono de sello para un emoji:
 *  - Si tiene dibujo "gourmet" curado → lo usa (más lindo).
 *  - Sino, descarga el PNG de Twemoji y lo embebe como <image> (color real).
 *  - Si Twemoji falla → check ✓ como último recurso.
 * Se resuelve UNA vez por strip (todos los sellos comparten el mismo ícono).
 */
export async function resolveStampIconRenderer(
  emoji: string,
): Promise<IconRenderer> {
  if (ICON_MAP[emoji]) return ICON_MAP[emoji];
  const png = await fetchTwemojiPng(emoji);
  if (!png) return checkFallback;
  const dataUri = `data:image/png;base64,${png.toString('base64')}`;
  return (cx, cy, size, _id) => {
    // Twemoji 72×72 tiene poco padding; lo agrandamos un toque para que llene
    // bien el círculo del sello.
    const s = size * 1.12;
    const x = cx - s / 2;
    const y = cy - s / 2;
    return `<image href="${dataUri}" x="${x}" y="${y}" width="${s}" height="${s}" />`;
  };
}

// Cache url → PNG data URI (o null si no se pudo cargar). Las versiones "llena"
// y "atenuada" del mismo ícono reusan la misma descarga. Con tope de entradas y
// de bytes: cada data URI de 256×256 pesa decenas de KB.
const customIconCache = new CacheAcotada<string | null>({
  maxEntradas: MAX_ENTRADAS_CACHE_ICONOS,
  maxBytes: 32 * 1024 * 1024,
  pesar: (s) => s?.length ?? 0,
});

/** Largo máximo de URL que se acepta; igual que el DTO del panel. */
export const MAX_LARGO_URL_ICONO = 2048;

async function fetchCustomIconDataUri(url: string): Promise<string | null> {
  // Una URL que no es de nuestro almacenamiento no se descarga NI se cachea.
  if (!url || url.length > MAX_LARGO_URL_ICONO || !urlDeIconoPermitida(url)) {
    return null;
  }
  if (customIconCache.has(url)) return customIconCache.get(url) ?? null;
  try {
    const r = await descargarAcotado(url, {
      timeoutMs: 4000,
      maxBytes: MAX_BYTES_ICONO_PROPIO,
    });
    if (!r.ok) {
      customIconCache.set(
        url,
        null,
        esEstadoPasajero(r.status) ? TTL_FALLO_PASAJERO_MS : TTL_FALLO_DEFINITIVO_MS,
      );
      return null;
    }
    const raw = r.buffer;
    // Detecta SVG (por content-type o por el propio contenido) para rasterizar
    // con densidad alta; PNG/JPG entran directo.
    const isSvg =
      /svg/i.test(r.contentType) ||
      raw.slice(0, 300).toString('utf8').trimStart().startsWith('<');
    const sharp = (await import('sharp')).default;
    const base = sharp(raw, isSvg ? { density: 384 } : undefined);
    // Recorta el margen muerto del archivo (borde transparente o de color
    // uniforme). Sin esto, un PNG con aire alrededor del dibujo se ve chico
    // dentro del sello por más que lo dibujemos al 100% del círculo.
    let src = base;
    try {
      src = sharp(await base.clone().trim().toBuffer());
    } catch {
      /* imagen uniforme o sin borde recortable → se usa tal cual */
    }
    const png = await src
      .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const uri = `data:image/png;base64,${png.toString('base64')}`;
    customIconCache.set(url, uri);
    return uri;
  } catch {
    // Red, timeout, demasiado grande o imagen corrupta: no se distingue bien
    // aquí, así que se trata como pasajero. Treinta segundos sin reintentar
    // bastan para no martillar R2; para siempre dejaba el ✓ de respaldo.
    customIconCache.set(url, null, TTL_FALLO_PASAJERO_MS);
    return null;
  }
}

/**
 * Renderer para un ícono de sello PERSONALIZADO (imagen PNG/SVG subida por el
 * negocio). Descarga + rasteriza a PNG 256×256 (fondo transparente) y la embebe
 * como <image> base64. `opacity` < 1 para el sello VACÍO (imagen atenuada).
 * Devuelve null si la imagen no se pudo cargar → el caller cae al emoji.
 *
 * OJO con `size`: acá es el **DIÁMETRO del círculo** del sello (no el ~55% que
 * usan los renderers de emoji). La imagen propia llena el círculo COMPLETO — se
 * dibujaba al ~74% y dejaba un anillo blanco alrededor. Se recorta con
 * clip-path circular para que una imagen cuadrada no se salga del sello.
 */
export async function resolveCustomImageRenderer(
  url: string,
  opts?: { opacity?: number },
): Promise<IconRenderer | null> {
  const dataUri = await fetchCustomIconDataUri(url);
  if (!dataUri) return null;
  const opacity = opts?.opacity ?? 1;
  return (cx, cy, size, id) => {
    const s = size;
    const x = cx - s / 2;
    const y = cy - s / 2;
    const op = opacity < 1 ? ` opacity="${opacity}"` : '';
    const clip = `stampImgClip_${id}_${opacity < 1 ? 'f' : 'c'}`;
    return `<defs><clipPath id="${clip}"><circle cx="${cx}" cy="${cy}" r="${s / 2}"/></clipPath></defs><image href="${dataUri}" x="${x}" y="${y}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${clip})"${op} />`;
  };
}
