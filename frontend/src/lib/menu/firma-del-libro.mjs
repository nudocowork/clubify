/**
 * La firma del menú libro: quién aparece al pie de la carta.
 *
 * LA REGLA (la misma de `public-page-metadata.ts`): sin marca resuelta NO se
 * pinta nada. Nunca un `|| 'Clubify'` ni `soyclubify.com` de respaldo.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * El pie de `/book/<slug>` tenía las dos fugas a la vez:
 *
 *     href={s.brand?.websiteUrl || 'https://soyclubify.com'}
 *     {s.brand?.name || 'Clubify'}
 *
 * En operación normal no se notaba: `resolveByWhiteLabelId` del backend nunca
 * devuelve null —cae al WhiteLabel `clubify` y `normalize()` rellena el
 * nombre—, así que `brand` siempre viene con algo. La fuga salta cuando la
 * respuesta llega SIN `brand`: backend caído, una respuesta vieja cacheada o
 * un cambio de shape. Justo el escenario del 2026-08-14, cuando el /login de
 * Sellea se quedó pintado como Clubify durante una caída.
 *
 * Y aquí duele más que en el login: es la carta que el negocio de marca
 * blanca enseña a SUS clientes. Firmarla con el nombre y el dominio de la
 * plataforma delata que hay otra empresa detrás.
 *
 * Un pie vacío no delata a nadie; uno inventado sí. Ver [[clubify-fugas-de-marca]].
 *
 * Las reglas viven aquí y no dentro del componente para poder probarlas desde
 * node sin montar React:
 *   node scripts/pruebas-libro-firma.mjs
 *
 * @typedef {{ name?: string | null, websiteUrl?: string | null } | null | undefined} MarcaDelNegocio
 * @typedef {{ nombre: string, enlace: string | null }} Firma
 */

/** Texto que de verdad dice algo, ya recortado. `null` si no. */
function textoUtil(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

/**
 * Enlace de la marca, solo si es una web de verdad.
 *
 * El `websiteUrl` lo arma nuestro backend (`https://${domain}`) a partir de un
 * campo editable de la marca, así que el filtro por protocolo es barato y
 * evita que un `javascript:` acabe en el pie de la carta de un negocio.
 */
function enlaceSeguro(url) {
  const s = textoUtil(url);
  if (!s) return null;
  if (!/^https?:\/\/[^/\s]/i.test(s)) return null;
  return s;
}

/**
 * Qué firma se pinta al pie de la carta.
 *
 * Tres casos, y los tres importan:
 *
 * 1. Sin nombre de marca → `null`: no se pinta NADA. Es el caso que arregla
 *    la fuga, y por eso no hay respaldo de ningún tipo.
 * 2. Con nombre pero sin web usable → se pinta el nombre como TEXTO. La
 *    atribución se conserva y no se inventa un destino; mandar al cliente a
 *    la plataforma sería la otra mitad de la misma fuga.
 * 3. Con nombre y web → nombre enlazado a SU web.
 *
 * @param {MarcaDelNegocio} brand
 * @returns {Firma | null}
 */
export function firmaDelLibro(brand) {
  const nombre = textoUtil(brand?.name);
  if (!nombre) return null;
  return { nombre, enlace: enlaceSeguro(brand?.websiteUrl) };
}
