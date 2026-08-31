/**
 * DECISIÓN de mora — regla ÚNICA y pura (sin DB, sin efectos) que decide qué
 * hacer con un negocio en cada corrida del cron diario de cobros.
 *
 * Es el corazón del control de renovaciones (Fase 1, 2026-08-31). Se extrajo de
 * `BillingService.processOverdueAccounts` para poder probar con reloj congelado
 * el caso que fallaba: "no suspende al día 6". La misma regla vale para Hotmart,
 * Stripe y pago por fuera (manualPayment) — el ancla cambia, la regla no.
 *
 * Ancla de la mora (día 0):
 *   - Cobro fallido (failedPaymentCount>0): `firstFailedAt` — INMUTABLE, fijado
 *     en el 1er fallo. NO usar `lastPaymentAttemptAt`: Hotmart lo pisa a `now`
 *     en cada reintento y reiniciaba el reloj (causa raíz del bug). Fallback a
 *     `lastPaymentAttemptAt` solo para morosos legacy sin `firstFailedAt`.
 *   - Fecha vencida sin renovar: `currentPeriodEnd` (para pago por fuera es el
 *     último ManualPayment + periodicidad).
 *
 * Gracia: cubre los días 1..graceDays; al día graceDays+1 se suspende
 * (con graceDays=5 → suspende el día 6).
 */

export interface DunningState {
  failedPaymentCount: number | null;
  firstFailedAt: Date | null;
  lastPaymentAttemptAt: Date | null;
  currentPeriodEnd: Date | null;
  lastChargeAt: Date | null;
}

export interface DunningConfig {
  graceDays: number;
  /** Día en que se manda el 1er recordatorio (D+reminderDay). */
  reminderDay: number;
  /** Día del aviso "mañana se pausa" (D+noticeDay). */
  noticeDay: number;
  /** Tope legacy: más allá de esto NO se auto-suspende por FECHA vencida
   *  (evita pausar en masa cuentas viejas con currentPeriodEnd que nunca
   *  avanzó). No aplica a la vía de cobro fallido explícito. */
  staleCapDays: number;
}

export type DunningAction =
  | 'none' // no está en mora / renovado / aún no toca nada
  | 'reminder' // recordatorio D+1
  | 'notice' // aviso "mañana se pausa" D+2
  | 'suspend' // pasó la gracia → suspender
  | 'stale-skip'; // pasó la gracia por FECHA pero supera el tope legacy → no auto-suspender

export interface DunningDecision {
  /** Día 0 de la mora. null = el negocio no está en mora. */
  dueSince: Date | null;
  /** true = cobro fallido explícito (Hotmart/Stripe); false = fecha vencida. */
  byFailure: boolean;
  /** Días calendario transcurridos desde `dueSince`. */
  daysOverdue: number;
  action: DunningAction;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fecha en que se suspenderá = día (graceDays + 1) desde `dueSince`. */
export function pauseDateFor(dueSince: Date, graceDays: number): Date {
  return new Date(dueSince.getTime() + (graceDays + 1) * DAY_MS);
}

export function decideDunning(
  t: DunningState,
  now: Date,
  cfg: DunningConfig,
): DunningDecision {
  let dueSince: Date | null = null;
  let byFailure = false;

  if ((t.failedPaymentCount ?? 0) > 0) {
    dueSince = t.firstFailedAt ?? t.lastPaymentAttemptAt;
    if (dueSince) byFailure = true;
  }
  if (
    !dueSince &&
    t.currentPeriodEnd &&
    t.currentPeriodEnd.getTime() < now.getTime()
  ) {
    // Fecha vencida y NO renovada (sin un pago posterior al fin del ciclo).
    const renewed =
      t.lastChargeAt != null &&
      t.lastChargeAt.getTime() >= t.currentPeriodEnd.getTime();
    if (!renewed) dueSince = t.currentPeriodEnd;
  }

  if (!dueSince) {
    return { dueSince: null, byFailure: false, daysOverdue: 0, action: 'none' };
  }

  const daysOverdue = Math.floor((now.getTime() - dueSince.getTime()) / DAY_MS);

  if (daysOverdue < cfg.reminderDay) {
    return { dueSince, byFailure, daysOverdue, action: 'none' };
  }
  // Gracia superada → suspender (salvo el tope legacy por fecha vencida).
  if (daysOverdue > cfg.graceDays) {
    if (!byFailure && daysOverdue > cfg.staleCapDays) {
      return { dueSince, byFailure, daysOverdue, action: 'stale-skip' };
    }
    return { dueSince, byFailure, daysOverdue, action: 'suspend' };
  }
  if (daysOverdue === cfg.noticeDay) {
    return { dueSince, byFailure, daysOverdue, action: 'notice' };
  }
  if (daysOverdue === cfg.reminderDay) {
    return { dueSince, byFailure, daysOverdue, action: 'reminder' };
  }
  // Días intermedios de gracia (p.ej. 3, 4, 5): sin acción nueva.
  return { dueSince, byFailure, daysOverdue, action: 'none' };
}
