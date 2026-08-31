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
  // El prefijo {platform} = nombre de la MARCA del negocio (Sellea/Clubify),
  // resuelto por SmsTemplatesService.render desde el tenant. NUNCA hardcodear
  // "Clubify" aquí: un negocio de una marca blanca debe ver el nombre de SU marca.
  // Serie pre-cobro (PDF734) — tono personal 1:1 al dueño ({ownerName}).
  // Solo negocios Clubify (el cron filtra la marca). {platform} = "Clubify".
  {
    id: 'payment_reminder_7d',
    label: 'Recordatorio de cobro (7 días antes)',
    description: 'Se envía 7 días antes de la renovación. Tono personal al dueño.',
    vars: ['platform', 'ownerName'],
    group: 'cliente',
    default:
      'Hola {ownerName} 👋 Te escribo para recordarte que en 7 días se renueva tu suscripción de {platform}. Verifica que tengas saldo disponible en tu tarjeta para que el pago pase sin problema 🙌 Cualquier cosa estoy aquí para ayudarte.',
  },
  {
    id: 'payment_reminder_3d',
    label: 'Recordatorio de cobro (3 días antes)',
    description: 'Se envía 3 días antes de la renovación. Tono personal al dueño.',
    vars: ['platform', 'ownerName'],
    group: 'cliente',
    default:
      'Hola {ownerName} 👋 En 3 días se renueva tu suscripción de {platform}. Verifica que tu tarjeta tenga saldo para que el pago pase sin problema 🙌 Cualquier cosa, aquí estoy.',
  },
  {
    id: 'payment_reminder_tomorrow',
    label: 'Recordatorio de cobro (1 día antes)',
    description: 'Se envía 1 día antes de la renovación. Tono personal al dueño.',
    vars: ['platform', 'ownerName', 'brandName', 'chargeDate'],
    group: 'cliente',
    default:
      'Hola {ownerName} 👋 Te escribo porque mañana se renueva tu suscripción de {platform}. Revisa que tu tarjeta tenga saldo para que no pierdas acceso a tu cuenta. Si tienes alguna duda, me dices…',
  },
  {
    id: 'payment_due_today',
    label: 'Recordatorio de cobro (mismo día)',
    description: 'Se envía el día en que se procesa la renovación. Tono personal al dueño.',
    vars: ['platform', 'ownerName'],
    group: 'cliente',
    default:
      'Hola {ownerName} 👋 Te escribo porque hoy se procesa el pago de tu suscripción de {platform}. Si ya tienes saldo, no tienes que hacer nada, todo sigue normal ✅ Si no tienes saldo, tu pago no se va a procesar y lo más probable es que pierdas acceso a tu cuenta. Cualquier cosa estoy aquí para ayudarte.',
  },
  {
    id: 'payment_confirmed',
    label: 'Pago confirmado',
    description: 'Se envía cuando Hotmart aprueba un pago.',
    vars: ['platform', 'brandName', 'nextChargeInfo'],
    group: 'cliente',
    default: '{platform}: Pago de {brandName} recibido.{nextChargeInfo} ¡Gracias!',
  },
  {
    id: 'trial_started',
    label: 'Prueba iniciada',
    description:
      'Se envía cuando un negocio ancla la tarjeta y entra a la prueba de 7 días (aún no se cobra). El primer cobro es al terminar la prueba.',
    vars: ['platform', 'brandName', 'trialDays', 'chargeDate'],
    group: 'cliente',
    default:
      '{platform}: Tu prueba de {brandName} está activa 🎉 En {trialDays} días ({chargeDate}) se te hace el primer cobro. ¡Gracias!',
  },
  {
    id: 'payment_failed',
    label: 'Pago falló',
    description: 'Se envía cuando Hotmart reporta un pago fallido.',
    vars: ['platform', 'brandName'],
    group: 'cliente',
    default:
      '{platform}: Tu pago de {brandName} falló. Actualiza tu tarjeta o reintenta en la pasarela de pago para no pausar tu cuenta.',
  },
  {
    id: 'payment_overdue_reminder',
    label: 'Recordatorio de pago vencido (D+1)',
    description:
      'Se envía 1 día después de un cobro fallido o de la fecha de cobro vencida, si el pago sigue pendiente.',
    vars: ['platform', 'brandName', 'pauseDate'],
    group: 'cliente',
    default:
      '{platform}: El pago de {brandName} sigue pendiente. Regularízalo en la pasarela para evitar la pausa del {pauseDate}.',
  },
  {
    id: 'payment_not_processed_2d',
    label: 'Pago no procesado (2 días después)',
    description:
      'Se envía 2 días después de la fecha de cobro si el pago no se procesó. Tono personal al dueño. Reemplaza al aviso de pausa (D+2) en la secuencia.',
    vars: ['platform', 'ownerName'],
    group: 'cliente',
    default:
      'Hola {ownerName} 👋 Te escribo porque el pago de tu suscripción de {platform} no pudo procesarse. Necesito que actualices o confirmes el saldo de tu tarjeta para que no se te suspenda la cuenta y tus clientes dejen de recibir tus notificaciones push. Escríbeme y en 2 minutos lo resolvemos 🙌',
  },
  {
    id: 'account_will_pause',
    label: 'Aviso de pausa (legacy)',
    description:
      'Aviso corto de pausa. La secuencia ahora usa "Pago no procesado (2 días después)"; se mantiene editable por compatibilidad.',
    vars: ['platform', 'brandName', 'pauseDate'],
    group: 'cliente',
    default:
      '{platform}: Si no se regulariza el pago de {brandName} antes del {pauseDate}, tu cuenta se pausará automáticamente.',
  },
  {
    id: 'account_paused',
    label: 'Cuenta pausada',
    description: 'Se envía cuando la cuenta se pausa por falta de pago.',
    vars: ['platform', 'brandName'],
    group: 'cliente',
    default:
      '{platform}: Tu cuenta de {brandName} quedó pausada por falta de pago. Reactiva en la pasarela de pago para volver al instante.',
  },
  {
    id: 'account_reactivated',
    label: 'Cuenta reactivada',
    description:
      'Se envía cuando una cuenta pausada/suspendida vuelve a estar activa tras un pago (Hotmart o Stripe).',
    vars: ['platform', 'brandName'],
    group: 'cliente',
    default:
      '{platform}: Tu cuenta de {brandName} fue reactivada correctamente. Ya puedes ingresar a tu panel.',
  },

  // ───────── Marca blanca (notificaciones de créditos desde Clubify) ─────────
  {
    id: 'wl_credits_purchased',
    label: 'Marca · Créditos acreditados',
    description:
      'Se envía a la marca blanca cuando se le acreditan créditos (compra Hotmart o asignación manual).',
    vars: ['platform', 'brandName', 'credits', 'available'],
    group: 'marca',
    default:
      '{platform}: Se acreditaron {credits} créditos a {brandName}. Saldo disponible: {available}.',
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
    id: 'wl_refund_window',
    label: 'Marca · Ventana de reembolso por vencer',
    description:
      'Se envía a la marca blanca cuando un crédito consumido está por salir de la ventana de reembolso (queda ~1 día).',
    vars: ['brandName', 'count'],
    group: 'marca',
    default:
      'Clubify: {brandName} tiene {count} crédito(s) con reembolso por vencer (queda ~1 día). Reembolsalos desde el panel si el negocio no pagó.',
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
