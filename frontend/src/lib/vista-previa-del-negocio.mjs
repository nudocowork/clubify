/**
 * Lo que WhatsApp, Facebook e Instagram pintan cuando alguien comparte el
 * enlace de un negocio: `og:url`, `canonical`, `og:image`, `theme-color` y el
 * favicon de la tarjeta.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Las páginas públicas (`/d`, `/m`, `/w`, `/o`) armaban esa vista previa con
 * `NEXT_PUBLIC_APP_URL` como base. En `app.selleala.com/d/empanadas-la-parada`
 * salía `og:url="https://soyclubify.com/d/…"` y `canonical` apuntando a
 * Clubify: los 12 negocios de Sellea con domicilio se anunciaban como copias
 * de páginas de otra plataforma. Y a un negocio sin logo ni portada se le
 * ponía como imagen `/og-image.png`, que es la tarjeta verde de Clubify — el
 * mismo archivo sirve también en el dominio de Sellea.
 *
 * LA REGLA (ver [[clubify-fugas-de-marca]]): sin marca resuelta NO se pinta
 * nada. Una vista previa sin imagen no delata a nadie; una inventada sí.
 *
 * Las funciones viven aquí y no en los layouts para poder probarlas desde node:
 *   node scripts/pruebas-vista-previa-marca.mjs
 */

/**
 * Hosts que son de la PLATAFORMA y no de un negocio ni de su marca.
 *
 * Si la página se sirve desde uno de estos, el host no dice nada de la marca
 * del negocio: un negocio de Sellea abierto en `soyclubify.com` tiene que
 * anunciarse con el dominio de Sellea, no con el que se usó para abrirlo.
 * `vercel.app` son los despliegues de vista previa; `localhost`, desarrollo.
 */
const HOSTS_DE_LA_PLATAFORMA = [
  /(^|\.)soyclubify\.com$/,
  /(^|\.)clubify\.app$/,
  /(^|\.)soyfidelity\.com$/,
  /\.vercel\.app$/,
  /^localhost$/,
  /^127\.\d+\.\d+\.\d+$/,
];

/**
 * El host de la petición, en minúsculas y sin puerto. Vacío si no parece un
 * nombre de dominio: la cabecera la manda el cliente y acaba escrita dentro de
 * un `<meta>`, así que no se acepta nada que no sean letras, dígitos, puntos y
 * guiones.
 */
export function hostLimpio(host) {
  if (typeof host !== 'string') return '';
  const h = host.trim().toLowerCase().replace(/:\d+$/, '');
  if (!h || h.length > 253) return '';
  if (!/^[a-z0-9.-]+$/.test(h)) return '';
  if (h.startsWith('.') || h.endsWith('.') || h.includes('..')) return '';
  return h;
}

/** Si el host es de la plataforma (no dice nada de la marca del negocio). */
export function esHostDeLaPlataforma(host) {
  const h = hostLimpio(host);
  if (!h) return false;
  return HOSTS_DE_LA_PLATAFORMA.some((re) => re.test(h));
}

/** `https://host` de una URL absoluta http(s). `null` si no lo es. */
function origenDe(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!hostLimpio(u.hostname)) return null;
    return `${u.protocol}//${u.host.toLowerCase()}`;
  } catch {
    return null;
  }
}

/**
 * Base (`https://host`, sin barra final) para `og:url` y `canonical`.
 *
 *   1. El host de la petición, si es de la marca o del propio negocio
 *      (`app.selleala.com`, `birrialeon.com`): es literalmente la dirección que
 *      se está compartiendo.
 *   2. Si no —la página se abrió desde un dominio de la plataforma—, la web de
 *      la MARCA del negocio. Para un negocio de Clubify es `soyclubify.com`,
 *      que es lo que salía hasta ahora; para uno de Sellea, `www.selleala.com`.
 *   3. Si tampoco hay web de marca: `null`, y el layout no pone `og:url` ni
 *      `canonical`. Nunca `NEXT_PUBLIC_APP_URL`, que es Clubify.
 *
 * @param {{ host?: string | null, websiteUrl?: string | null }} [datos]
 * @returns {string | null}
 */
export function baseDeLaVistaPrevia({ host, websiteUrl } = {}) {
  const h = hostLimpio(host);
  if (h && !esHostDeLaPlataforma(h)) return `https://${h}`;
  return origenDe(websiteUrl);
}

/**
 * La imagen de la vista previa: la primera URL ABSOLUTA http(s) de las que
 * se pasan, en orden de preferencia. `null` si ninguna sirve.
 *
 * Una ruta relativa (`/og-image.png`) se rechaza a propósito: se resolvería
 * contra el dominio que sirve la página, y ese archivo es la tarjeta de
 * Clubify en todos los dominios. Un `data:` tampoco vale: WhatsApp no lo
 * descarga y metería megas de base64 dentro del HTML.
 *
 * @param {...(string | null | undefined)} candidatas
 * @returns {string | null}
 */
export function imagenDeLaVistaPrevia(...candidatas) {
  for (const c of candidatas) {
    if (typeof c !== 'string') continue;
    const u = c.trim();
    if (!u) continue;
    try {
      const url = new URL(u);
      if (url.protocol === 'https:' || url.protocol === 'http:') return u;
    } catch {
      // No es absoluta: se prueba la siguiente.
    }
  }
  return null;
}

/**
 * Color de la barra del navegador. El primero que venga relleno, o `null`.
 * Antes caía a `#22C55E`, que es el verde de Clubify.
 *
 * @param {...(string | null | undefined)} candidatos
 * @returns {string | null}
 */
export function colorDelTema(...candidatos) {
  for (const c of candidatos) {
    if (typeof c !== 'string') continue;
    const v = c.trim();
    // Acaba escrito en un atributo: nada de comillas ni etiquetas.
    if (v && !/[<>"']/.test(v)) return v;
  }
  return null;
}

/**
 * Favicon de la tarjeta del cliente (`/w/<pase>`): el logo del negocio y, si
 * no tiene, los iconos de SU marca. `null` si no hay ninguno — antes caía a
 * los iconos estáticos de Clubify (`/favicon-32.png`, `/icons/icon.svg`), que
 * en una tarjeta de Sellea eran el logo de otra plataforma.
 *
 * @param {{ logoDelNegocio?: string | null, marca?: { faviconUrl?: string | null, iconUrl?: string | null, logoUrl?: string | null } | null }} [datos]
 * @returns {{ icon: string, apple: string } | null}
 */
export function iconosDelPase({ logoDelNegocio, marca } = {}) {
  const url = imagenDeLaVistaPrevia(
    logoDelNegocio,
    marca?.faviconUrl,
    marca?.iconUrl,
    marca?.logoUrl,
  );
  return url ? { icon: url, apple: url } : null;
}
