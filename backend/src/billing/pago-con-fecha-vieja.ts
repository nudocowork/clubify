import { addPlanPeriod } from '../common/plan-period';

/**
 * ¿El ciclo ya está pagado aunque la fecha de cobro se quedó vieja?
 * (blindaje anti-desincronización, BUG PDF734 — Quipao Bubble Tea).
 *
 *  1. `lastChargeAt >= currentPeriodEnd`: el cobro entró en o después de la
 *     fecha registrada como próximo cobro → esa fecha quedó vieja. Vale para
 *     cualquier pasarela.
 *  2. `currentPeriodEnd` antes de un período completo después del último
 *     cobro → la fecha avanzó de menos. Solo SIN Hotmart.
 *
 * Por qué la regla 2 no vale con Hotmart (La Burguesía, 2026-10-29): Hotmart
 * cobra SIEMPRE en el día de su ciclo, aunque el cliente pague tarde. Pagó el
 * 29-oct el cobro del 16-oct, y Hotmart dijo «próximo cobro 16-nov», que es la
 * verdad. La regla 2 vio «29-oct + 1 mes = 29-nov, y la fecha es 16-nov: se
 * quedó vieja», la «sanó» al 16-dic —un mes gratis— y de paso borró la mora.
 * El 16-nov el cobro falló y Clubify lo seguía teniendo al día hasta diciembre.
 * Con Hotmart la fecha la escribe `date_next_charge` en cada pago (desde
 * f8b067df, 2026-08-18): si va por detrás del pago, es la regla 1 quien la ve.
 *
 * Tampoco vale con PAGO POR FUERA (Motilart, 2026-11-16): ahí la fecha la pone
 * una persona a propósito. `pasar-a-pago-por-fuera.cjs` registró el pago del
 * 7-nov anclado a su vencimiento («próximo cobro 22-nov»), y la regla 2 lo
 * «sanó» al 22-dic. Además de regalar el mes, «Generar comisión ahora» vio el
 * pago fuera de ese ciclo inventado y fechó la comisión el día que se pulsó:
 * se fue al corte equivocado.
 */
export function pagoConFechaVieja(t: {
  lastChargeAt: Date | null;
  currentPeriodEnd: Date | null;
  planPeriodicity: string | null;
  hotmartSubscriberCode?: string | null;
  manualPayment?: boolean | null;
}): boolean {
  if (!t.lastChargeAt || !t.currentPeriodEnd) return false;
  if (t.lastChargeAt.getTime() >= t.currentPeriodEnd.getTime()) return true;
  if (t.hotmartSubscriberCode || t.manualPayment) return false;
  const dayMs = 24 * 60 * 60 * 1000;
  const expectedNext = addPlanPeriod(t.lastChargeAt, t.planPeriodicity);
  return t.currentPeriodEnd.getTime() < expectedNext.getTime() - 2 * dayMs;
}
