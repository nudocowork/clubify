/**
 * Direcciones de los GET PÚBLICOS y CACHEABLES que pide el navegador: el
 * negocio y la carta del menú digital, el menú libro y la tarjeta del
 * formulario de registro.
 *
 * POR QUÉ SON RELATIVAS
 *
 * El backend las responde con `s-maxage` (180 s el menú, 300 s la tarjeta)
 * para que el borde de Vercel las sirva sin despertar a la API. Pero el
 * navegador las pedía directo a `https://api.soyclubify.com`, que está en
 * Railway y no tiene caché delante: el `s-maxage` no servía de nada y cada
 * cliente que abría la carta pagaba el viaje entero.
 *
 * Por la ruta relativa `/api/...` la petición entra por el dominio de la
 * página (`app.soyclubify.com`, `app.selleala.com`, el dominio propio del
 * negocio…) y la reescritura de `next.config.js` la lleva al backend PASANDO
 * por la caché del borde. Medido en producción el 2026-09-17 con la carta de
 * empanadas-la-parada: directo a la API, 1,35–1,49 s cada vez; por
 * `app.selleala.com/api/...`, 0,35–0,41 s en cuanto hay `x-vercel-cache: HIT`
 * (la entrada se comparte entre dominios: la primera petición en
 * app.selleala.com ya salió HIT tras pedirla en app.soyclubify.com).
 *
 * QUÉ NO VA POR AQUÍ, y por qué:
 *   - POST y todo lo que lleve sesión: no se cachea y no debe cachearse.
 *   - El GET del InfoLink: cuenta visitas; servido desde la caché, dejaría de
 *     contarlas.
 *   - `storefront/locations` y la búsqueda por teléfono: el backend no les
 *     pone `s-maxage`, así que pasar por Vercel solo añadiría un salto.
 *
 * La consulta se arma EXACTAMENTE igual que antes (mismo orden de parámetros):
 * es la clave de la caché, y dos formas de escribir la misma URL serían dos
 * entradas que no se reaprovechan.
 *
 *   node scripts/pruebas-api-publica.mjs
 */

const seg = (v) => encodeURIComponent(String(v ?? '').trim());

/** `?a=1&b=2` con los pares que tengan valor, en el orden dado. */
function consulta(pares) {
  const partes = pares
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `${k}=${seg(v)}`);
  return partes.length ? `?${partes.join('&')}` : '';
}

/**
 * El negocio: `GET /api/public/m/:slug`. Sin `locale` no se añade (el menú
 * libro lo pide así y su entrada de caché es esa).
 *
 * @param {string} slug
 * @param {{ locale?: string | null, oficina?: string | null, fresco?: string | null }} [opciones]
 * @returns {string}
 */
export function urlDelNegocio(slug, { locale, oficina, fresco } = {}) {
  return `/api/public/m/${seg(slug)}${consulta([
    ['locale', locale],
    // Id de la carta de la OFICINA del enlace (`/d/<slug>?oficina=<id>`).
    ['oficina', oficina],
    // Solo la vista previa del panel (ver `fresco` abajo). SIEMPRE al final:
    // sin él la dirección de los clientes queda exactamente como antes.
    ['fresco', fresco],
  ])}`;
}

/**
 * La carta: `GET /api/public/m/:slug/menu`. La carta de la oficina se sirve
 * por el mismo `sede`, que ya acepta el id de una carta; si llegan los dos,
 * manda la sede.
 *
 * @param {string} slug
 * `fresco`: la vista previa del panel recarga el menú cada vez que el dueño
 * publica, y por la caché del borde (s-maxage 180 + stale-while-revalidate)
 * vería lo de antes hasta 3 minutos: «cambié el precio y no cambia». Con un
 * valor nuevo en cada publicación la vista previa estrena su propia entrada
 * de caché. El backend ignora el parámetro.
 *
 * @param {{ locale?: string | null, mode?: string | null, sede?: string | null, oficina?: string | null, fresco?: string | null }} [opciones]
 * @returns {string}
 */
export function urlDelMenu(slug, { locale, mode, sede, oficina, fresco } = {}) {
  return `/api/public/m/${seg(slug)}/menu${consulta([
    ['locale', locale],
    ['mode', mode],
    ['sede', sede || oficina],
    ['fresco', fresco],
  ])}`;
}

/**
 * El menú libro: `GET /api/public/m/:slug/menu-book`.
 *
 * @param {string} slug
 * @returns {string}
 */
export function urlDelLibro(slug) {
  return `/api/public/m/${seg(slug)}/menu-book`;
}

/**
 * La tarjeta del formulario de registro: `GET /api/passes/enroll/:cardId`.
 * SOLO el GET. El POST de la misma ruta crea el pase y va directo a la API.
 *
 * @param {string} cardId
 * @param {{ locale?: string | null }} [opciones]
 * @returns {string}
 */
export function urlDeLaTarjeta(cardId, { locale } = {}) {
  return `/api/passes/enroll/${seg(cardId)}${consulta([['locale', locale]])}`;
}
