/**
 * Helper compartido para calcular la fecha de vencimiento efectiva de
 * un pass. Tres modalidades (mutuamente excluyentes en la Card):
 *
 * - validUntil seteado → vence en esa fecha (pasada por el dueño)
 * - validDaysAfterIssue seteado → vence en pass.issuedAt + N días
 * - ninguno → no vence (Ilimitado)
 *
 * Devuelve null si la tarjeta es ilimitada.
 */
export function computePassExpiry(pass: {
  issuedAt: Date;
  card: {
    validUntil: Date | null;
    validDaysAfterIssue: number | null;
  };
}): Date | null {
  const c = pass.card;
  if (c.validUntil) return c.validUntil;
  if (c.validDaysAfterIssue) {
    return new Date(
      pass.issuedAt.getTime() + c.validDaysAfterIssue * 86400_000,
    );
  }
  return null;
}
