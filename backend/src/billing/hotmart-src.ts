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

/**
 * El código de origen (afiliado y/o marca) que el checkout le pasó a Hotmart y
 * que Hotmart devuelve en el aviso del pago. null si el pago no trae ninguno.
 *
 * POR QUÉ TANTAS RUTAS. Hasta el 2026-09-17 solo se miraba
 * `purchase.tracking.{source,source_sck,sck,external_code}`, y en producción
 * 0 de 353 avisos traían `tracking`: la atribución por Hotmart no había
 * funcionado nunca. En un checkout (`pay.hotmart.com`) Hotmart rastrea el
 * origen con `sck` (su ayuda: «SCK para checkout, SRC para páginas de venta») y
 * el webhook 2.0.0 lo devuelve en `purchase.origin`. Como no hay forma de probar
 * sin una compra real, se leen las rutas conocidas y, si Hotmart lo mueve, se
 * busca por nombre de clave dentro de `data`. Quien llama valida el valor contra
 * la base (un código o slug de afiliado, o un `wl_<uuid>`), así que un texto
 * cualquiera no atribuye nada.
 */
const CLAVES_DE_ORIGEN = ['sckPaymentLink', 'sck', 'src', 'source_sck', 'xcod', 'xcode'];

/**
 * TODOS los códigos de origen del pago, sin repetir y en orden de confianza.
 *
 * Una lista y no «el primero»: Hotmart puede rellenar `xcod`/`xcode` con SU
 * tracking (afiliados del marketplace, UTMify…) y dejar el nuestro en
 * `sckPaymentLink`; quedarse con el primero probaba el ajeno y el nuestro nunca
 * (revisión de Fable, 2026-09-17). Quien llama prueba cada uno contra la base
 * hasta que uno resuelva. Primero lo que ponemos nosotros (`sck`), `xcod` al
 * final.
 */
export function codigosDeOrigenDelPago(payload: unknown): string[] {
  const data = (payload as { data?: Record<string, any> } | null)?.data;
  const compra = data?.purchase;
  const conocidos: unknown[] = [
    compra?.sckPaymentLink,
    compra?.origin?.sck,
    compra?.origin?.src,
    compra?.tracking?.source_sck,
    compra?.tracking?.sck,
    compra?.tracking?.source,
    compra?.tracking?.external_code,
    compra?.origin?.xcod,
    compra?.origin?.xcode,
  ];
  const vistos = new Set<string>();
  const out: string[] = [];
  const meter = (v: unknown) => {
    if (typeof v !== 'string') return;
    const t = v.trim();
    if (t && !vistos.has(t)) {
      vistos.add(t);
      out.push(t);
    }
  };
  conocidos.forEach(meter);
  recogerClavesDeOrigen(data, 0, meter);
  return out;
}

/** El primero de `codigosDeOrigenDelPago`, o null. */
export function codigoDeOrigenDelPago(payload: unknown): string | null {
  return codigosDeOrigenDelPago(payload)[0] ?? null;
}

function recogerClavesDeOrigen(nodo: unknown, profundidad: number, meter: (v: unknown) => void) {
  if (!nodo || typeof nodo !== 'object' || profundidad > 5) return;
  for (const [clave, valor] of Object.entries(nodo as Record<string, unknown>)) {
    if (CLAVES_DE_ORIGEN.includes(clave)) meter(valor);
  }
  for (const valor of Object.values(nodo as Record<string, unknown>)) {
    recogerClavesDeOrigen(valor, profundidad + 1, meter);
  }
}
