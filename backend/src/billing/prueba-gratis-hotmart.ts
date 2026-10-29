/**
 * PRUEBA GRATIS DE HOTMART — una «compra» que no cobró nada.
 *
 * Los enlaces de prueba gratis (oct-2026) son suscripciones con el primer
 * período a 0: Hotmart manda `PURCHASE_APPROVED` con `price.value = 0` y el
 * cobro de verdad llega al terminar la prueba (`date_next_charge`).
 *
 * Contabilidad registra el PRECIO DEL PLAN, no lo pagado (decisión del dueño,
 * 2026-09-03, por el FX), así que sin este corte una prueba entraba como venta
 * de USD 500 / 68, salía en el Sales Wall y generaba comisión al afiliado
 * (Licorera 27° y Clínica del Celular La 33, 28-10-2026).
 *
 * Solo cuenta como prueba un 0 EXPLÍCITO: un evento que no trae precio NO es
 * una prueba (hay eventos sin `price` y son cobros reales).
 */
export function esPruebaGratisHotmart(payload: unknown): boolean {
  const compra = (payload as { data?: { purchase?: Record<string, unknown> } } | null)?.data?.purchase;
  if (!compra) return false;
  const precio = (compra.price as { value?: unknown } | undefined)?.value;
  if (!esCero(precio)) return false;
  // Si Hotmart dice cuál era el precio lleno y no es 0, es un cupón del 100 %
  // u otra cosa rara, no una prueba: se deja como estaba.
  const lleno = (compra.full_price as { value?: unknown } | undefined)?.value;
  if (lleno !== undefined && lleno !== null && !esCero(lleno)) return false;
  // Una recurrencia 2+ a 0 no es la prueba (la prueba es la primera).
  const rec = Number(compra.recurrence_number);
  if (Number.isInteger(rec) && rec > 1) return false;
  return true;
}

function esCero(v: unknown): boolean {
  if (typeof v === 'number') return v === 0;
  if (typeof v === 'string' && v.trim() !== '') return Number(v) === 0;
  return false;
}
