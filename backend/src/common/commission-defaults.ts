/**
 * Defaults de comisión — FUENTE ÚNICA (#1, 2026-06-16).
 *
 * Son los porcentajes fallback que se aplican SOLO cuando un ReferralCode no
 * tiene `commissionPercent` propio y no hay un Setting `referrals.default*Percent`
 * configurado. En la práctica casi nunca se disparan (el schema da
 * `commissionPercent @default(20)` y los Settings traen su valor), pero antes
 * estaban hardcodeados sueltos como `?? 25 / ?? 30 / ?? 10 / ?? 5` repartidos
 * por referrals.service.ts, hotmart.service.ts y commission-recalc — divergían
 * entre sí. Centralizados acá para que haya un solo lugar donde cambiarlos.
 *
 * El % REAL de cada afiliado vive en `ReferralCode.commissionPercent` (editable
 * por el admin) — estos defaults son la última red de seguridad, no la verdad.
 */
export const COMMISSION_DEFAULTS = {
  /** Influencer directo (campaña propia). */
  influencerPct: 30,
  /** Embajador (directo o bajo influencer). */
  ambassadorPct: 25,
  /** Vendedor bajo embajador/influencer. */
  vendorPct: 10,
  /** Influencer indirecto (5% sobre la venta de su embajador). */
  indirectPct: 5,
  /** Socio de plataforma (corte sobre toda venta). */
  socioPct: 10,
} as const;
