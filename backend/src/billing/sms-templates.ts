/**
 * Registro de plantillas SMS editables que el sistema envía automáticamente
 * (secuencia de cobro Hotmart). El texto se puede editar desde el SuperAdmin
 * (Integraciones → Plantillas SMS); si no hay override en Setting se usa el
 * `default` de acá — por eso editar nada deja el comportamiento idéntico.
 *
 * Tokens disponibles por plantilla en `vars`; se interpolan con {token}.
 * Mantener cada mensaje < 160 chars para 1 segmento de SMS.
 */
export type SmsTemplateDef = {
  id: string;
  label: string;
  description: string;
  vars: string[];
  default: string;
};

export const SMS_TEMPLATES: SmsTemplateDef[] = [
  {
    id: 'payment_reminder_tomorrow',
    label: 'Recordatorio de cobro (D-1)',
    description: 'Se envía 1 día antes del cobro recurrente en Hotmart.',
    vars: ['brandName', 'chargeDate'],
    default:
      'Clubify: Tu cobro de {brandName} es mañana ({chargeDate}). Verifica tu tarjeta en Hotmart si cambió.',
  },
  {
    id: 'payment_confirmed',
    label: 'Pago confirmado',
    description: 'Se envía cuando Hotmart aprueba un pago.',
    vars: ['brandName', 'nextChargeInfo'],
    default: 'Clubify: Pago de {brandName} recibido.{nextChargeInfo} ¡Gracias!',
  },
  {
    id: 'payment_failed',
    label: 'Pago falló',
    description: 'Se envía cuando Hotmart reporta un pago fallido.',
    vars: ['brandName'],
    default:
      'Clubify: Tu pago de {brandName} falló. Actualiza tu tarjeta o reintenta en Hotmart para no pausar tu cuenta.',
  },
  {
    id: 'account_will_pause',
    label: 'Aviso de pausa (D+2)',
    description:
      'Se envía si el pago no se regulariza antes de la fecha de pausa.',
    vars: ['brandName', 'pauseDate'],
    default:
      'Clubify: Si no se regulariza el pago de {brandName} antes del {pauseDate}, tu cuenta se pausará automáticamente.',
  },
  {
    id: 'account_paused',
    label: 'Cuenta pausada',
    description: 'Se envía cuando la cuenta se pausa por falta de pago.',
    vars: ['brandName'],
    default:
      'Clubify: Tu cuenta de {brandName} quedó pausada por falta de pago. Reactiva en Hotmart para volver al instante.',
  },
];

/** Reemplaza {token} por su valor. Tokens sin valor quedan literales. */
export function interpolateSms(
  tpl: string,
  vars: Record<string, string>,
): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

/** Formato de fecha corto es-CO ("5 jun") usado en los SMS de cobro. */
export function fmtSmsDate(d: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
  }).format(d);
}
