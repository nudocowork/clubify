/**
 * Cómo se pasa una imagen del bucket por el optimizador de Next
 * (`/_next/image?url=…&w=…&q=…`) sin romperla.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Nació dentro del menú libro (`menu/imagen-del-libro.mjs`) y se sacó aquí
 * cuando las portadas de sección, el logo y el aviso del menú digital
 * necesitaron lo mismo: en Konys las 15 portadas bajaban 5 MB de originales.
 *
 * Lo delicado no es armar la URL, es saber cuándo NO hacerlo. El optimizador
 * responde **400** a lo que no admite, y un 400 no degrada: deja la imagen EN
 * BLANCO (dentro de un `srcset` el navegador no cae al `src`). Comprobado
 * contra producción el 2026-09-17:
 *   - un ancho fuera de la lista (w=900)                    → 400
 *   - un host fuera de `remotePatterns` (images.unsplash.com) → 400
 *   - supabase fuera de `/storage/v1/object/public/`        → 400
 *   - el bucket por `http://` en vez de `https://`           → 400
 * Una original de 4,4 MB sí la acepta (200, 269 KB a w=828).
 *
 * Así que ante la duda la imagen se sirve CRUDA: pesa más, pero se ve.
 *
 *   node scripts/pruebas-libro-imagenes.mjs
 *   node scripts/pruebas-imagenes-del-menu.mjs
 */

/**
 * Anchos que el optimizador de Next acepta por defecto (`deviceSizes`).
 * Pedirle uno que no esté en la lista responde 400. (También acepta los de
 * `imageSizes`, de 16 a 384, pero no se usan: no los necesitamos y así hay una
 * sola lista que vigilar.)
 */
export const ANCHOS_PERMITIDOS = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];

/**
 * Lo que `next.config.js` declara en `images.remotePatterns`, con protocolo y
 * ruta: el optimizador compara las TRES cosas, no solo el host. Hay una prueba
 * que lee `next.config.js` para que las dos listas no se separen en silencio.
 */
const PATRONES_OPTIMIZABLES = [
  { protocolo: 'https:', host: /\.r2\.dev$/i },
  { protocolo: 'https:', host: /\.r2\.cloudflarestorage\.com$/i },
  { protocolo: 'https:', host: /^cdn\.soyclubify\.com$/i },
  { protocolo: 'https:', host: /^lh3\.googleusercontent\.com$/i },
  { protocolo: 'https:', host: /^static-media\.hotmart\.com$/i },
  {
    protocolo: 'https:',
    host: /^ugbqfcogmqkuhhepecfq\.supabase\.co$/i,
    ruta: '/storage/v1/object/public/',
  },
  { protocolo: 'http:', host: /^localhost$/i },
];

/**
 * Si el HOST está entre los configurados (o es una ruta del propio sitio).
 * Solo mira el host: es lo que la prueba compara con `next.config.js`. Para
 * decidir si una URL concreta se optimiza, `esOptimizable`.
 */
export function hostOptimizable(url) {
  const u = typeof url === 'string' ? url.trim() : '';
  if (!u) return false;
  // Ruta del propio sitio: la sirve Next, no hace falta whitelist.
  if (u.startsWith('/')) return true;
  let host;
  try {
    host = new URL(u).hostname;
  } catch {
    return false;
  }
  return PATRONES_OPTIMIZABLES.some((p) => p.host.test(host));
}

/**
 * Si ESTA URL se puede mandar al optimizador sin que responda 400.
 *
 * @param {unknown} url
 * @returns {boolean}
 */
export function esOptimizable(url) {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (!u) return false;
  // Una imagen incrustada (base64) o local del navegador no se optimiza: la
  // primera hay que sacarla al bucket, y eso no se arregla desde el menú.
  if (u.startsWith('data:') || u.startsWith('blob:')) return false;
  // Ya viene envuelta: volver a envolverla da una URL anidada que responde 400.
  if (u.startsWith('/_next/image')) return false;
  // `//host/x.jpg` no es una ruta del sitio: es otro host sin protocolo.
  if (u.startsWith('//')) return false;
  if (u.startsWith('/')) return !esSvg(u);
  let url_;
  try {
    url_ = new URL(u);
  } catch {
    return false;
  }
  if (esSvg(url_.pathname)) return false;
  return PATRONES_OPTIMIZABLES.some(
    (p) =>
      p.protocolo === url_.protocol &&
      p.host.test(url_.hostname) &&
      (!p.ruta || url_.pathname.startsWith(p.ruta)),
  );
}

/**
 * Un SVG no pasa por el optimizador (Next lo rechaza sin
 * `dangerouslyAllowSVG`, y `next/image` lo sirve tal cual por lo mismo). Un
 * logo en SVG es además lo más ligero que hay: no hay nada que ahorrar.
 */
function esSvg(ruta) {
  return /\.svg$/i.test(String(ruta).split(/[?#]/)[0]);
}

/**
 * El ancho permitido más cercano al pedido (nunca inventamos uno).
 *
 * @param {unknown} ancho
 * @returns {number}
 */
export function anchoPermitido(ancho) {
  const n = Number(ancho);
  if (!Number.isFinite(n)) return ANCHOS_PERMITIDOS[0];
  return ANCHOS_PERMITIDOS.reduce((mejor, a) =>
    Math.abs(a - n) < Math.abs(mejor - n) ? a : mejor,
  );
}

/**
 * URL de la imagen pasada por el optimizador.
 *
 * RELATIVA a propósito: el menú también se sirve desde el dominio propio del
 * negocio y desde el de una marca blanca. Un host escrito a mano metería
 * `soyclubify.com` dentro de la carta de otra marca.
 *
 * Devuelve la URL original cuando no se puede optimizar, para que se siga
 * viendo.
 *
 * @param {unknown} url
 * @param {number} ancho
 * @param {number} [calidad]
 * @returns {string}
 */
export function urlOptimizada(url, ancho, calidad = 75) {
  if (!esOptimizable(url)) return typeof url === 'string' ? url : '';
  const w = anchoPermitido(ancho);
  const q = Math.min(100, Math.max(1, Math.round(Number(calidad) || 75)));
  return `/_next/image?url=${encodeURIComponent(String(url).trim())}&w=${w}&q=${q}`;
}

/**
 * `srcset` con los anchos dados. `null` cuando la URL no es optimizable: en
 * ese caso el `<img>` se queda con su `src` crudo y sin un srcset roto.
 *
 * @param {unknown} url
 * @param {number[]} anchos
 * @param {number} [calidad]
 * @returns {string | null}
 */
export function srcSetOptimizado(url, anchos, calidad = 75) {
  if (!esOptimizable(url)) return null;
  const unicos = [...new Set(anchos.map(anchoPermitido))].sort((a, b) => a - b);
  return unicos.map((w) => `${urlOptimizada(url, w, calidad)} ${w}w`).join(', ');
}
