/**
 * Templates SMS para la secuencia de notificaciones de cobro Hotmart.
 * Se envían vía Grow Business desde el sub-account del tenant. Cada
 * mensaje queda < 160 caracteres para entrar en 1 segmento de SMS y
 * evitar split (más caro y a veces llegan desordenados).
 */

function fmtDate(d: Date) {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
  }).format(d);
}

export function smsPaymentReminderTomorrow(args: {
  brandName: string;
  chargeDate: Date;
}): string {
  return `Clubify: Tu cobro de ${args.brandName} es mañana (${fmtDate(args.chargeDate)}). Verifica tu tarjeta en Hotmart si cambió.`;
}

export function smsPaymentConfirmed(args: {
  brandName: string;
  nextChargeDate: Date | null;
}): string {
  const next = args.nextChargeDate
    ? ` Próximo cobro: ${fmtDate(args.nextChargeDate)}.`
    : '';
  return `Clubify: Pago de ${args.brandName} recibido.${next} ¡Gracias!`;
}

export function smsPaymentFailed(args: { brandName: string }): string {
  return `Clubify: Tu pago de ${args.brandName} falló. Actualiza tu tarjeta o reintenta en Hotmart para no pausar tu cuenta.`;
}

export function smsAccountWillPause(args: {
  brandName: string;
  pauseDate: Date;
}): string {
  return `Clubify: Si no se regulariza el pago de ${args.brandName} antes del ${fmtDate(args.pauseDate)}, tu cuenta se pausará automáticamente.`;
}

export function smsAccountPaused(args: { brandName: string }): string {
  return `Clubify: Tu cuenta de ${args.brandName} quedó pausada por falta de pago. Reactiva en Hotmart para volver al instante.`;
}
