/**
 * Diff de un beneficio para el historial (spec §6). Helper PURO: sin DB, para
 * poder testear el borde que importa — qué cuenta como "cambió".
 */

/** Campos cuyo cambio vale la pena registrar. El resto es ruido. */
export const TRACKED_BENEFIT_FIELDS = [
  'type', 'title', 'description', 'terms',
  'percentOff', 'amountOffCents', 'normalPriceCents', 'memberPriceCents', 'currency',
  'validFrom', 'validUntil',
  'maxRedemptions', 'maxPerMember', 'limitPeriod',
  'status', 'approval', 'categoryId',
] as const;

export type BenefitDiff = Record<string, { from: unknown; to: unknown }>;

/** Normaliza para comparar: las fechas se comparan por instante, no por objeto. */
function norm(v: unknown): unknown {
  if (v instanceof Date) return v.getTime();
  if (v === undefined) return null;
  // Prisma devuelve Decimal para algunos numéricos; su toString es estable.
  if (v && typeof v === 'object' && 'toString' in v && !Array.isArray(v)) {
    const s = String(v);
    if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  }
  return v;
}

/**
 * Campos que cambiaron entre `before` y `after`. Solo mira los TRACKED y solo
 * los que vienen en `after`: un update parcial no debe reportar como "cambiado"
 * todo lo que no se tocó.
 */
export function diffBenefit(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): BenefitDiff {
  const out: BenefitDiff = {};
  for (const f of TRACKED_BENEFIT_FIELDS) {
    if (!(f in after)) continue;          // no vino en el update
    if (after[f] === undefined) continue; // vino explícito como undefined
    const a = norm(before[f]);
    const b = norm(after[f]);
    if (a === b) continue;                // no cambió de verdad
    out[f] = { from: before[f] ?? null, to: after[f] ?? null };
  }
  return out;
}

/** Cómo se guarda al actor. Se congela para que el historial siga legible. */
export function actorOf(user: { id?: string; fullName?: string | null; role?: string } | null) {
  return {
    userId: user?.id ?? null,
    actorName: user?.fullName ?? '',
    actorRole: user?.role ?? '',
  };
}
