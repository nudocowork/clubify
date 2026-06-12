/**
 * periodKey — string YYYY-MM en UTC para identificar el mes de
 * devengamiento de una Commission. Sirve como componente del UNIQUE
 * constraint (referralUseId, recipientCodeId, periodKey) que previene
 * duplicados a nivel DB.
 */
export function monthKey(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
