/**
 * Un pase de un solo uso (cupón, descuento o regalo) que ya se canjeó.
 *
 * UNA regla para Apple (`voided`), Google (`state`) y la página pública del
 * pase. Antes cada uno la escribía a su manera y solo miraba `COUPON`: un
 * DESCUENTO o un REGALO de un uso, cerrados al canjear, seguían pareciendo
 * vigentes en el teléfono; y Google CREABA el objeto siempre ACTIVE, así que
 * abrir la página de un cupón ya usado que nunca se había guardado instalaba
 * el café gratis otra vez (&N COFFEE, 2026-11-24).
 *
 * Un cupón INDEFINIDO nunca queda «usado»: se canjea en cada visita.
 */
const DE_UN_USO = new Set(['COUPON', 'DISCOUNT', 'GIFT']);

type PaseMinimo = {
  status?: string | null;
  card?: { type?: string | null; couponIndefinido?: boolean | null } | null;
};

export function esCuponUsado(pass: PaseMinimo): boolean {
  return (
    pass.status === 'COMPLETED' &&
    DE_UN_USO.has(String(pass.card?.type ?? '')) &&
    !pass.card?.couponIndefinido
  );
}

/** INACTIVE lo manda a «pases vencidos» en Google Wallet. */
export function estadoDelObjetoDeGoogle(pass: PaseMinimo): 'ACTIVE' | 'INACTIVE' {
  return pass.status === 'REVOKED' || esCuponUsado(pass) ? 'INACTIVE' : 'ACTIVE';
}
