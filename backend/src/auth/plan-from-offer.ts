/**
 * Deriva la PERIODICIDAD de un plan a partir del OFFER CODE del pago de Hotmart,
 * matcheándolo contra el `off=` de los checkoutUrls de los 4 planes. Es la fuente
 * DETERMINISTA (independiente de moneda/monto), a diferencia de la heurística por
 * nombre de producto o por valor — que se equivocaba (un mensual pagado en moneda
 * local con `currency_code` ausente → value alto → "ANUAL" mal). Helpers PUROS.
 */

export type Periodicity = 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';

/** planId (mensual/…) → código de periodicidad del Tenant. */
export const PLAN_TO_PERIODICITY: Record<string, Periodicity> = {
  mensual: 'MENSUAL',
  trimestral: 'TRIMESTRAL',
  semestral: 'SEMESTRAL',
  anual: 'ANUAL',
};

/** Extrae el offer code (`off=`) de una URL de checkout de Hotmart. null si no hay. */
export function offerCodeFromUrl(url?: string | null): string | null {
  const s = (url ?? '').trim();
  if (!s) return null;
  const m = s.match(/[?&]off=([^&#]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).trim() || null;
  } catch {
    return m[1].trim() || null;
  }
}

/**
 * Periodicidad determinista a partir del offer code del pago, matcheado contra el
 * `off=` de los checkoutUrls de los planes. `plans` = { mensual: url|null, … }.
 * Devuelve null si no matchea (el caller cae a la heurística por nombre).
 */
export function periodicityFromOfferCode(
  purchaseOfferCode?: string | null,
  plans?: Partial<Record<string, string | null>> | null,
): Periodicity | null {
  const code = (purchaseOfferCode ?? '').trim().toLowerCase();
  if (!code || !plans) return null;
  for (const [planId, url] of Object.entries(plans)) {
    const off = offerCodeFromUrl(url);
    if (off && off.toLowerCase() === code) {
      return PLAN_TO_PERIODICITY[planId] ?? null;
    }
  }
  return null;
}

/** Periodicidad por el NOMBRE del producto (segunda fuente, después del offer). */
export function periodicityFromName(productName?: string | null): Periodicity | null {
  const upper = String(productName ?? '').toUpperCase();
  if (/ANUAL/.test(upper)) return 'ANUAL';
  if (/SEMESTRAL/.test(upper)) return 'SEMESTRAL';
  if (/TRIMESTRAL/.test(upper)) return 'TRIMESTRAL';
  if (/MENSUAL|MENSU/.test(upper)) return 'MENSUAL';
  return null;
}

/**
 * Periodicidad por MONTO — SOLO cuando la moneda es explícitamente USD (los
 * landing plans se definieron en USD: ~68/150/278/500). Si la moneda es null o
 * local, devuelve null: NO adivinamos (ese era el bug del "Plan Anual").
 */
export function periodicityFromValue(
  value?: number | null,
  currency?: string | null,
): Periodicity | null {
  if (currency !== 'USD') return null; // sin `|| !currency`: no asumir USD
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v >= 400) return 'ANUAL';
  if (v >= 250) return 'SEMESTRAL';
  if (v >= 120) return 'TRIMESTRAL';
  return 'MENSUAL';
}

/**
 * Resuelve la periodicidad con la precedencia correcta:
 *   1) OFFER CODE (determinista) → 2) NOMBRE del producto → 3) MONTO (solo USD).
 */
export function resolvePeriodicity(input: {
  offerCode?: string | null;
  plans?: Partial<Record<string, string | null>> | null;
  productName?: string | null;
  value?: number | null;
  currency?: string | null;
}): Periodicity | null {
  return (
    periodicityFromOfferCode(input.offerCode, input.plans) ??
    periodicityFromName(input.productName) ??
    periodicityFromValue(input.value, input.currency)
  );
}
