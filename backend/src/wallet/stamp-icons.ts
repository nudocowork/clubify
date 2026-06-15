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

type IconRenderer = (cx: number, cy: number, size: number, id: string) => string;

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
// re-descargar el mismo emoji en cada generación de strip.
const twemojiCache = new Map<string, Buffer | null>();

/**
 * Descarga el PNG color del emoji desde el CDN de Twemoji (jsdelivr). Devuelve
 * el buffer o null si falla / no existe. Cacheado por emoji. Esto permite que
 * CUALQUIER emoji del picker se vea como ícono de sello en el wallet (antes
 * solo ~9 tenían dibujo propio y el resto caía a un check — bug 2026-06-15).
 */
export async function fetchTwemojiPng(emoji: string): Promise<Buffer | null> {
  if (twemojiCache.has(emoji)) return twemojiCache.get(emoji) ?? null;
  const code = twemojiCodepoints(emoji);
  if (!code) {
    twemojiCache.set(emoji, null);
    return null;
  }
  const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${code}.png`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      twemojiCache.set(emoji, null);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    twemojiCache.set(emoji, buf);
    return buf;
  } catch {
    twemojiCache.set(emoji, null);
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
