/**
 * Registro de plantillas SMS editables que el sistema envía automáticamente
 * (secuencia de cobro Hotmart). El texto se puede editar desde el SuperAdmin
 * (Integraciones → Plantillas SMS); si no hay override en Setting se usa el
 * `default` de acá — por eso editar nada deja el comportamiento idéntico.
 *
 * Tokens disponibles por plantilla en `vars`; se interpolan con {token}.
 * Mantener cada mensaje < 160 chars para 1 segmento de SMS.
 */
/** Grupo de la plantilla, para separarlas en el panel:
 *  - `cliente`: van al negocio que paga directo a la pasarela (Hotmart).
 *  - `marca`: van al dueño de la marca blanca (notificaciones de créditos),
 *    se envían desde Clubify con la subcuenta global de Grow Business. */
export type SmsTemplateGroup = 'cliente' | 'marca';

export type SmsTemplateDef = {
  id: string;
  label: string;
  description: string;
  vars: string[];
  default: string;
  group: SmsTemplateGroup;
};

export const SMS_TEMPLATES: SmsTemplateDef[] = [
  // ───────── Cliente final (negocio que paga directo a Hotmart) ─────────
  {
    id: 'payment_reminder_tomorrow',
    label: 'Recordatorio de cobro (D-1)',
    description: 'Se envía 1 día antes del cobro recurrente en la pasarela de pago.',
    vars: ['brandName', 'chargeDate'],
    group: 'cliente',
    default:
      'Clubify: Tu cobro de {brandName} es mañana ({chargeDate}). Verifica tu tarjeta en la pasarela de pago si cambió.',
  },
  {
    id: 'payment_confirmed',
    label: 'Pago confirmado',
    description: 'Se envía cuando Hotmart aprueba un pago.',
    vars: ['brandName', 'nextChargeInfo'],
    group: 'cliente',
    default: 'Clubify: Pago de {brandName} recibido.{nextChargeInfo} ¡Gracias!',
  },
  {
    id: 'payment_failed',
    label: 'Pago falló',
    description: 'Se envía cuando Hotmart reporta un pago fallido.',
    vars: ['brandName'],
    group: 'cliente',
    default:
      'Clubify: Tu pago de {brandName} falló. Actualiza tu tarjeta o reintenta en la pasarela de pago para no pausar tu cuenta.',
  },
  {
    id: 'account_will_pause',
    label: 'Aviso de pausa (D+2)',
    description:
      'Se envía si el pago no se regulariza antes de la fecha de pausa.',
    vars: ['brandName', 'pauseDate'],
    group: 'cliente',
    default:
      'Clubify: Si no se regulariza el pago de {brandName} antes del {pauseDate}, tu cuenta se pausará automáticamente.',
  },
  {
    id: 'account_paused',
    label: 'Cuenta pausada',
    description: 'Se envía cuando la cuenta se pausa por falta de pago.',
    vars: ['brandName'],
    group: 'cliente',
    default:
      'Clubify: Tu cuenta de {brandName} quedó pausada por falta de pago. Reactiva en la pasarela de pago para volver al instante.',
  },

  // ───────── Marca blanca (notificaciones de créditos desde Clubify) ─────────
  {
    id: 'wl_credits_purchased',
    label: 'Marca · Créditos acreditados',
    description:
      'Se envía a la marca blanca cuando se le acreditan créditos (compra Hotmart o asignación manual).',
    vars: ['brandName', 'credits', 'available'],
    group: 'marca',
    default:
      'Clubify: Se acreditaron {credits} créditos a {brandName}. Saldo disponible: {available}.',
  },
  {
    id: 'wl_credits_low',
    label: 'Marca · Saldo bajo (2 créditos)',
    description:
      'Se envía a la marca blanca cuando su saldo baja a 2 créditos o menos. Una sola vez hasta recargar.',
    vars: ['brandName', 'available'],
    group: 'marca',
    default:
      'Clubify: A {brandName} le quedan {available} créditos. Recarga para seguir activando negocios sin interrupción.',
  },
  {
    id: 'wl_clients_pending',
    label: 'Marca · Negocios pendientes por créditos',
    description:
      'Se envía a la marca blanca cuando tiene negocios en la bandeja de pendientes por falta de créditos.',
    vars: ['brandName', 'count'],
    group: 'marca',
    default:
      'Clubify: {brandName} tiene {count} negocio(s) esperando activación por falta de créditos. Recarga para activarlos.',
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
