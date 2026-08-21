/**
 * Catálogo de CORREOS automáticos del ciclo de vida de la suscripción que la
 * plataforma (o una MARCA BLANCA) le manda al dueño del negocio que compró.
 *
 * Es el gemelo por email de `SMS_TEMPLATES` / `brand-message-templates.ts`:
 * mismos eventos, mismo panel (Master Admin → Marcas → Automatizaciones, y el
 * panel de la propia marca), misma precedencia de override
 *   marca (`email.wl.<wlId>.<id>`) > global (`email.<id>`) > default de acá.
 * A diferencia del SMS, cada plantilla tiene ASUNTO + CUERPO; ambos se guardan
 * juntos en el Setting como JSON `{"subject":"…","body":"…"}`.
 *
 * ENVÍO — dos condiciones, las dos necesarias:
 *   1. La marca tiene conexión de email configurada (`WhiteLabel.emailConfig`).
 *      Sin conexión NO se envía nada: una marca blanca nunca manda correos con
 *      el remitente de Clubify. La marca `clubify` usa la cuenta de plataforma.
 *   2. La plantilla no está apagada para esa marca (`email.enabled.*` = 'false').
 *      Los correos vienen ON por defecto; la marca puede apagar los que no quiera.
 *
 * El CUERPO es texto plano con tokens `{token}`. El sistema lo envuelve en el
 * marco de marca (logo, color, pie) — la marca escribe texto, nunca HTML, así
 * ningún correo se puede romper ni inyectar markup.
 */

export type EmailTemplateDef = {
  id: string;
  label: string;
  /** Nombre a mostrar dentro de su carpeta. */
  folderLabel?: string;
  description: string;
  /** Tokens {token} disponibles en asunto y cuerpo. */
  vars: string[];
  /** Asunto por defecto (también interpolable). */
  subject: string;
  /** Cuerpo por defecto (texto plano; línea en blanco = párrafo nuevo). */
  default: string;
  folder: string;
  audience: string;
  /** Botón del correo. `urlVar` es el token que trae la URL destino. */
  cta?: { label: string; urlVar: string };
};

/** Carpeta de sistema donde viven los correos en Automatizaciones. */
export const EMAIL_FOLDER = { id: 'correos', name: 'Correos' } as const;

/** Tokens comunes a casi todos los correos del ciclo de vida. */
const BASE_VARS = ['platform', 'brandName', 'ownerName', 'panelUrl'];

export const EMAIL_TEMPLATES: EmailTemplateDef[] = [
  {
    id: 'email_panel_ready',
    label: 'Panel creado (pago aprobado)',
    folderLabel: 'Panel creado',
    description:
      'El correo clave: se envía cuando se aprueba el PRIMER pago y el panel del cliente queda activo. Incluye la URL del panel y el correo con el que entra.',
    vars: [...BASE_VARS, 'loginEmail', 'nextChargeDate', 'supportEmail'],
    subject: '🎉 Tu panel de {brandName} ya está listo',
    default:
      '¡Listo, {ownerName}! Tu pago quedó confirmado y **{brandName}** ya está activo.\n\n' +
      'Entra a tu panel con este correo: {loginEmail}\n\n' +
      'Estos son los primeros pasos para arrancar hoy mismo:\n\n' +
      '1. Sube tu catálogo (categorías y productos)\n' +
      '2. Personaliza tu tarjeta de fidelización\n' +
      '3. Comparte tu link público con tus clientes\n' +
      '4. Activa tu primera automatización\n\n' +
      'Tu próxima renovación es el {nextChargeDate}. Cualquier duda, respóndenos este correo.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
    cta: { label: 'Entrar a mi panel', urlVar: 'panelUrl' },
  },
  {
    id: 'email_buyer_activation',
    label: 'Pago recibido sin cuenta creada',
    folderLabel: 'Pago sin cuenta',
    description:
      'Se envía al comprador que pagó (Hotmart o la pasarela de la marca) y todavía no creó su cuenta, con el enlace para activarla. El botón «Reenviar» de Pagos sin activar manda este mismo correo.',
    // Va al COMPRADOR, que aún no tiene negocio: acá no existen {brandName} ni
    // {ownerName} — la identidad es la de la MARCA ({platform}).
    vars: ['platform', 'buyerName', 'loginEmail', 'activateUrl'],
    subject: '🎉 Recibimos tu pago — crea tu cuenta de {platform}',
    default:
      'Hola {buyerName}, ¡tu pago llegó bien! 🎉\n\n' +
      'Solo falta un paso: crear tu cuenta en **{platform}** para entrar a tu panel. Toma menos de un minuto.\n\n' +
      'Importante: regístrate con el mismo correo con el que pagaste ({loginEmail}) para que tu cuenta se active al instante.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al comprador',
    cta: { label: 'Crear mi cuenta', urlVar: 'activateUrl' },
  },
  {
    id: 'email_payment_reminder_7d',
    label: 'Recordatorio de cobro (7 días antes)',
    folderLabel: 'Recordatorio 7 días antes',
    description:
      'Aviso amable 7 días antes de la renovación. Mismo disparo que el SMS D-7: negocio activo, con fecha de cobro dentro de 7 días, una sola vez por ciclo.',
    vars: [...BASE_VARS, 'chargeDate'],
    subject: 'Tu renovación de {brandName} es el {chargeDate}',
    default:
      'Hola {ownerName}, te avisamos con tiempo: el {chargeDate} renovamos tu suscripción de **{brandName}**.\n\n' +
      'No tienes que hacer nada, el cobro sale solo. Si quieres cambiar el medio de pago o revisar tu plan, entra a tu panel.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
    cta: { label: 'Revisar mi suscripción', urlVar: 'panelUrl' },
  },
  {
    id: 'email_payment_reminder_3d',
    label: 'Recordatorio de cobro (3 días antes)',
    folderLabel: 'Recordatorio 3 días antes',
    description:
      'Segundo aviso, 3 días antes de la renovación. Mismo disparo que el SMS D-3: una sola vez por ciclo.',
    vars: [...BASE_VARS, 'chargeDate'],
    subject: 'En 3 días renovamos tu plan de {brandName}',
    default:
      'Hola {ownerName}, en 3 días ({chargeDate}) se renueva tu suscripción de **{brandName}**.\n\n' +
      'Si tu tarjeta sigue vigente no tienes que hacer nada. Si cambió o está por vencer, actualízala ahora y evitas que el cobro falle.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
    cta: { label: 'Revisar mi suscripción', urlVar: 'panelUrl' },
  },
  {
    id: 'email_payment_reminder_tomorrow',
    label: 'Recordatorio de cobro (1 día antes)',
    folderLabel: 'Recordatorio 1 día antes',
    description:
      'Aviso el día antes del cobro. Mismo disparo que el SMS D-1: una sola vez por ciclo.',
    vars: [...BASE_VARS, 'chargeDate'],
    subject: 'Mañana renovamos tu plan de {brandName}',
    default:
      'Hola {ownerName}, mañana ({chargeDate}) se procesa el cobro de tu suscripción de **{brandName}**.\n\n' +
      'Si tu tarjeta cambió o está por vencer, actualízala hoy para que la renovación no falle.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
    cta: { label: 'Actualizar mi medio de pago', urlVar: 'panelUrl' },
  },
  {
    id: 'email_payment_due_today',
    label: 'Cobro de hoy',
    folderLabel: 'Cobro hoy',
    description:
      'Aviso el mismo día en que se procesa la renovación. Mismo disparo que el SMS D-0: una sola vez por ciclo.',
    vars: [...BASE_VARS, 'chargeDate'],
    subject: 'Hoy renovamos tu plan de {brandName}',
    default:
      'Hola {ownerName}, hoy se procesa la renovación de **{brandName}**.\n\n' +
      'Si todo sale bien no tienes que hacer nada: te llega la confirmación en cuanto se acredite. Si el cobro falla, te avisamos para que lo resuelvas.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
    cta: { label: 'Ver mi suscripción', urlVar: 'panelUrl' },
  },
  {
    id: 'email_payment_confirmed',
    label: 'Pago confirmado (renovación)',
    folderLabel: 'Pago confirmado',
    description:
      'Se envía en cada renovación aprobada (no en la primera compra, que manda "Panel creado"). Confirma el cobro e informa la próxima fecha.',
    vars: [...BASE_VARS, 'nextChargeDate'],
    subject: 'Recibimos tu pago de {brandName}',
    default:
      'Hola {ownerName}, confirmamos el pago de tu suscripción de **{brandName}**.\n\n' +
      'Tu cuenta sigue activa sin interrupciones. Próximo cobro: {nextChargeDate}.\n\n' +
      'Gracias por seguir con nosotros.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
    cta: { label: 'Ver mi panel', urlVar: 'panelUrl' },
  },
  {
    id: 'email_payment_failed',
    label: 'Pago demorado / rechazado',
    folderLabel: 'Pago demorado',
    description:
      'Se envía cuando la pasarela reporta un pago demorado, rechazado o en disputa. Pide revisar el medio de pago antes de que la cuenta se pause.',
    vars: BASE_VARS,
    subject: 'No pudimos procesar tu pago de {brandName}',
    default:
      'Hola {ownerName}, tuvimos un problema al procesar el pago de **{brandName}**.\n\n' +
      'Revisa tu medio de pago para que tu cuenta no se pause. Si ya lo resolviste, ignora este correo — el cobro se reintenta automáticamente.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
    cta: { label: 'Revisar mi suscripción', urlVar: 'panelUrl' },
  },
  {
    id: 'email_payment_overdue',
    label: 'Pago vencido (recordatorio)',
    folderLabel: 'Pago vencido',
    description:
      'Primer recordatorio de mora, un día después de que el cobro quedó pendiente. Avisa la fecha en que la cuenta se pausaría.',
    vars: [...BASE_VARS, 'pauseDate'],
    subject: 'Tu pago de {brandName} quedó pendiente',
    default:
      'Hola {ownerName}, el cobro de **{brandName}** quedó pendiente y tu cuenta sigue activa por ahora.\n\n' +
      'Si no se regulariza antes del {pauseDate}, la cuenta se pausa y tu panel deja de estar disponible. Actualizar el medio de pago toma un minuto.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
    cta: { label: 'Regularizar mi pago', urlVar: 'panelUrl' },
  },
  {
    id: 'email_account_will_pause',
    label: 'Aviso de pausa próxima',
    folderLabel: 'Aviso de pausa',
    description:
      'Último aviso antes de pausar la cuenta por falta de pago.',
    vars: BASE_VARS,
    subject: 'Tu cuenta de {brandName} está por pausarse',
    default:
      'Hola {ownerName}, seguimos sin poder cobrar la suscripción de **{brandName}**.\n\n' +
      'Si no se regulariza, la cuenta se pausa y tu panel deja de estar disponible para ti y para tus clientes. Tus datos quedan guardados: al pagar, todo vuelve tal como estaba.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
    cta: { label: 'Regularizar mi pago', urlVar: 'panelUrl' },
  },
  {
    id: 'email_account_paused',
    label: 'Cuenta pausada',
    folderLabel: 'Cuenta pausada',
    description: 'Se envía cuando la cuenta queda suspendida por falta de pago.',
    vars: BASE_VARS,
    subject: 'Tu cuenta de {brandName} quedó pausada',
    default:
      'Hola {ownerName}, pausamos **{brandName}** porque no pudimos completar el cobro.\n\n' +
      'Tu información está intacta. Apenas se procese el pago, tu panel y tu página pública vuelven a funcionar al instante.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
    cta: { label: 'Reactivar mi cuenta', urlVar: 'panelUrl' },
  },
  {
    id: 'email_account_reactivated',
    label: 'Cuenta reactivada',
    folderLabel: 'Cuenta reactivada',
    description:
      'Se envía cuando una cuenta suspendida vuelve a activarse tras un pago.',
    vars: [...BASE_VARS, 'nextChargeDate'],
    subject: '{brandName} está activo de nuevo',
    default:
      '¡Buenas noticias, {ownerName}! Recibimos tu pago y **{brandName}** volvió a estar activo.\n\n' +
      'Tu panel y tu página pública ya están funcionando otra vez. Próximo cobro: {nextChargeDate}.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
    cta: { label: 'Entrar a mi panel', urlVar: 'panelUrl' },
  },
  {
    id: 'email_refunded',
    label: 'Reembolso procesado',
    folderLabel: 'Reembolso',
    description:
      'Se envía cuando se procesa un reembolso y la cuenta queda suspendida.',
    vars: [...BASE_VARS, 'supportEmail'],
    subject: 'Procesamos tu reembolso de {brandName}',
    default:
      'Hola {ownerName}, procesamos el reembolso de **{brandName}** y tu cuenta quedó suspendida.\n\n' +
      'Tus datos siguen guardados por si más adelante quieres volver. Si esto fue un error o necesitas ayuda, respóndenos este correo.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
  },
  {
    id: 'email_chargeback',
    label: 'Contracargo registrado',
    folderLabel: 'Contracargo',
    description:
      'Se envía cuando el banco registra un contracargo y la cuenta se suspende.',
    vars: [...BASE_VARS, 'supportEmail'],
    subject: 'Se registró un contracargo en {brandName}',
    default:
      'Hola {ownerName}, el banco registró un contracargo sobre el pago de **{brandName}** y tu cuenta quedó suspendida.\n\n' +
      'Escríbenos respondiendo este correo para regularizarlo y reactivar tu servicio.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
  },
  {
    id: 'email_dispute',
    label: 'Pago en disputa',
    folderLabel: 'Pago en disputa',
    description:
      'Se envía cuando la pasarela abre una disputa sobre un pago. Todavía no es un contracargo: busca contacto antes de que escale.',
    vars: [...BASE_VARS, 'supportEmail'],
    subject: 'Hay una disputa abierta sobre tu pago de {brandName}',
    default:
      'Hola {ownerName}, se abrió una disputa sobre el pago de **{brandName}**.\n\n' +
      'Mientras se resuelve, tu cuenta sigue funcionando. Si fue un error o no reconoces el cobro, respóndenos este correo y lo aclaramos contigo antes de que escale a contracargo.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
  },
  {
    id: 'email_cancellation',
    label: 'Suscripción cancelada',
    folderLabel: 'Cancelación',
    description:
      'Se envía cuando el cliente cancela su suscripción. Deja la puerta abierta para volver.',
    vars: [...BASE_VARS, 'supportEmail'],
    subject: 'Cancelamos tu suscripción de {brandName}',
    default:
      'Hola {ownerName}, cancelamos la suscripción de **{brandName}** como pediste.\n\n' +
      'Guardamos tu información por si quieres retomarla más adelante — puedes reactivarla cuando quieras desde tu panel.\n\n' +
      'Gracias por haber confiado en nosotros. Si nos quieres contar qué falló, respóndenos este correo: nos sirve muchísimo.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
  },
  {
    id: 'email_charge_date_moved',
    label: 'Próximo cobro movido',
    folderLabel: 'Cobro movido',
    description:
      'Se envía cuando cambia la fecha del próximo cobro de la suscripción.',
    vars: [...BASE_VARS, 'nextChargeDate'],
    subject: 'Movimos la fecha de tu próximo cobro de {brandName}',
    default:
      'Hola {ownerName}, actualizamos la fecha del próximo cobro de **{brandName}**.\n\n' +
      'Tu nueva fecha es el {nextChargeDate}. Tu plan y tu servicio siguen igual, solo cambia cuándo se procesa el pago.',
    folder: EMAIL_FOLDER.id,
    audience: 'Al negocio',
    cta: { label: 'Ver mi suscripción', urlVar: 'panelUrl' },
  },
];

/** Override de la MARCA para un correo. Valor = JSON `{subject, body}`. */
export function emailTplKey(whiteLabelId: string, id: string): string {
  return `email.wl.${whiteLabelId}.${id}`;
}
/** Override GLOBAL (todas las marcas) para un correo. */
export function globalEmailTplKey(id: string): string {
  return `email.${id}`;
}
/** Interruptor por marca: valor 'false' = no enviar ese correo. */
export function emailEnabledKey(whiteLabelId: string, id: string): string {
  return `email.enabled.wl.${whiteLabelId}.${id}`;
}
/** Interruptor global: valor 'false' = no enviar ese correo en ninguna marca. */
export function globalEmailEnabledKey(id: string): string {
  return `email.enabled.${id}`;
}

export function isEmailTemplateId(id: string): boolean {
  return EMAIL_TEMPLATES.some((t) => t.id === id);
}

export function findEmailTemplate(id: string): EmailTemplateDef | undefined {
  return EMAIL_TEMPLATES.find((t) => t.id === id);
}

/**
 * Lee el valor guardado de un correo. Acepta el JSON `{subject, body}` y, por
 * tolerancia, un string suelto (se interpreta como cuerpo y conserva el asunto
 * por defecto). Devuelve solo las partes realmente personalizadas.
 */
export function parseEmailTplValue(raw: string | null | undefined): {
  subject?: string;
  body?: string;
} {
  const v = (raw ?? '').trim();
  if (!v) return {};
  if (v.startsWith('{')) {
    try {
      const parsed = JSON.parse(v) as { subject?: unknown; body?: unknown };
      const subject =
        typeof parsed.subject === 'string' && parsed.subject.trim()
          ? parsed.subject.trim()
          : undefined;
      const body =
        typeof parsed.body === 'string' && parsed.body.trim()
          ? parsed.body.trim()
          : undefined;
      return { subject, body };
    } catch {
      // JSON corrupto → lo tratamos como cuerpo plano (no perdemos el texto).
      return { body: v };
    }
  }
  return { body: v };
}

/** Serializa asunto+cuerpo para guardar en Setting. Vacío = volver al default. */
export function serializeEmailTplValue(opts: {
  subject?: string | null;
  body?: string | null;
}): string | null {
  const subject = (opts.subject ?? '').trim();
  const body = (opts.body ?? '').trim();
  if (!subject && !body) return null;
  return JSON.stringify({
    ...(subject ? { subject } : {}),
    ...(body ? { body } : {}),
  });
}

/** Formato de fecha de los correos ("14 de agosto de 2026"). Más legible que
 *  el de los SMS (`fmtSmsDate`, "14 ago"), donde cada carácter cuesta. */
export function fmtEmailDate(d: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota',
  }).format(d);
}

/** Reemplaza `{token}` por su valor. Tokens sin valor quedan vacíos. */
export function interpolateEmail(
  tpl: string,
  vars: Record<string, string>,
): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');
}

type SettingReader = {
  setting: {
    findMany(args: {
      where: { key: { in: string[] } };
    }): Promise<{ key: string; value: string }[]>;
  };
};

/**
 * Asunto + cuerpo EFECTIVOS de un correo (sin interpolar):
 * override de la marca > override global > default del catálogo. Cada parte se
 * resuelve por separado: una marca puede personalizar solo el asunto y heredar
 * el cuerpo, o al revés.
 */
export async function resolveEmailTemplate(
  prisma: SettingReader,
  id: string,
  whiteLabelId?: string | null,
): Promise<{ subject: string; body: string; source: 'brand' | 'global' | 'default' } | null> {
  const def = findEmailTemplate(id);
  if (!def) return null;
  const keys = [globalEmailTplKey(id)];
  if (whiteLabelId) keys.unshift(emailTplKey(whiteLabelId, id));
  const rows = await prisma.setting
    .findMany({ where: { key: { in: keys } } })
    .catch(() => [] as { key: string; value: string }[]);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const brand = whiteLabelId
    ? parseEmailTplValue(byKey.get(emailTplKey(whiteLabelId, id)))
    : {};
  const global = parseEmailTplValue(byKey.get(globalEmailTplKey(id)));
  const subject = brand.subject ?? global.subject ?? def.subject;
  const body = brand.body ?? global.body ?? def.default;
  const source =
    brand.subject || brand.body
      ? 'brand'
      : global.subject || global.body
        ? 'global'
        : 'default';
  return { subject, body, source };
}

/**
 * ¿Este correo está activado para la marca? Los correos vienen ON por defecto
 * (a diferencia de las plantillas SMS 'pending', que vienen OFF): el gate real
 * es tener conexión de email. La marca puede apagar uno puntual guardando
 * 'false' — y ese apagado de marca gana sobre el global.
 */
export async function isEmailTemplateEnabled(
  prisma: SettingReader,
  id: string,
  whiteLabelId?: string | null,
): Promise<boolean> {
  if (!isEmailTemplateId(id)) return false;
  const keys = [globalEmailEnabledKey(id)];
  if (whiteLabelId) keys.unshift(emailEnabledKey(whiteLabelId, id));
  const rows = await prisma.setting
    .findMany({ where: { key: { in: keys } } })
    .catch(() => [] as { key: string; value: string }[]);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  if (whiteLabelId) {
    const brand = byKey.get(emailEnabledKey(whiteLabelId, id))?.trim();
    if (brand === 'false') return false;
    if (brand === 'true') return true;
  }
  return byKey.get(globalEmailEnabledKey(id))?.trim() !== 'false';
}
