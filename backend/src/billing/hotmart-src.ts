/**
 * Parseo del `src` (tracking.source) de Hotmart — helpers PUROS (sin Nest/Prisma,
 * testeables solos). El `src` puede llevar DOS cosas a la vez:
 *   - token de RUTEO DE MARCA:   `wl_<uuid>`  (créditos → marca blanca)
 *   - código de AFILIADO:        `<CODE>`     (atribución de comisión)
 *
 * Formato combinado (2026-08-18): `<CODE>-wl_<uuid>` — así una compra por el link
 * de un afiliado en una marca blanca conserva AMBOS. Antes se pisaban entre sí:
 * `withWlToken` metía `src=wl_<uuid>` y la atribución de afiliado se descartaba al
 * ver el token de marca → el negocio quedaba "sin afiliado". Estos parsers extraen
 * cada parte por separado y son backward-compatible con los `src` viejos
 * (`wl_<uuid>` solo, `<CODE>` solo, o un uuid pelado).
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const WL_RE = new RegExp(`wl[_-](${UUID})`, 'i');
const BARE_UUID_RE = new RegExp(`^${UUID}$`, 'i');
// token de marca + un delimitador adyacente (para quitarlo del combinado).
const WL_STRIP_RE = new RegExp(`[._\\-~]?wl[_-]${UUID}[._\\-~]?`, 'i');

/** Extrae el whiteLabelId del src (marca). null si no hay token de marca. */
export function parseWlIdFromSrc(raw?: string | null): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const m = s.match(WL_RE);
  if (m) return m[1];
  // uuid pelado = id de marca sin prefijo.
  if (BARE_UUID_RE.test(s)) return s;
  return null;
}

/**
 * Extrae el CÓDIGO/slug de afiliado del src, quitando el token de marca si viene
 * combinado. Devuelve null si el src era SOLO marca (wl_<uuid> o uuid pelado) o
 * estaba vacío. NO valida que el código exista — eso lo hace el caller contra la DB.
 */
export function parseAffiliateRawFromSrc(raw?: string | null): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  // Un uuid pelado es marca, no afiliado.
  if (BARE_UUID_RE.test(s)) return null;
  const stripped = s.replace(WL_STRIP_RE, '').trim();
  return stripped || null;
}
