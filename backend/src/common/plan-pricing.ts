import { normalizePlanPeriod } from './plan-period';

/**
 * Precio canónico del bundle en USD según la periodicidad del plan.
 *
 * FUENTE ÚNICA: antes esta regla vivía duplicada como método privado en
 * hotmart.service (getCanonicalBundlePrice). El registro de pagos manuales
 * necesita el mismo importe sugerido, y dos copias de la tabla de precios
 * terminan divergiendo cuando alguien cambia una sola — por eso se extrajo
 * acá y hotmart.service delega en esta función.
 */
export const CANONICAL_BUNDLE_PRICES: Record<string, number> = {
  MENSUAL: 68,
  TRIMESTRAL: 150,
  SEMESTRAL: 278,
  ANUAL: 500,
};

/** Contrato mínimo sobre Prisma para poder testear sin base de datos. */
export type SettingLookup = {
  setting: {
    findUnique(args: {
      where: { key: string };
    }): PromiseLike<{ value: string | null } | null>;
  };
};

/**
 * Precio canónico del bundle en USD (68/150/278/500) según periodicidad,
 * con override por Setting `landing.plans.<period>.price` (el mismo que
 * edita el panel de landing — así el importe sugerido del pago manual y la
 * base de comisiones de Hotmart siempre cuentan la misma verdad).
 *
 * Periodicidad null/desconocida → MENSUAL, siguiendo la convención global
 * de plan-period.ts (sin normalizar, el tenant quedaba excluido silencioso
 * del cálculo con precio 0).
 */
export async function getCanonicalBundlePrice(
  db: SettingLookup,
  periodicity: string | null | undefined,
): Promise<number> {
  const period = normalizePlanPeriod(periodicity);
  const key = `landing.plans.${period.toLowerCase()}.price`;
  const row = await db.setting.findUnique({ where: { key } });
  const fromSetting = row?.value != null ? Number(row.value) : NaN;
  if (Number.isFinite(fromSetting) && fromSetting > 0) return fromSetting;
  return CANONICAL_BUNDLE_PRICES[period] ?? 0;
}
