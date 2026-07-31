/**
 * Catálogo unificado de mensajes automáticos (SMS/WhatsApp) que el sistema envía
 * y que una MARCA BLANCA puede ver y personalizar desde el Master Admin
 * (panel Marcas → Automatizaciones). Los mensajes se organizan en CARPETAS:
 *
 *  - `administrativa`: ciclo de suscripción del negocio (los 7 eventos que antes
 *                      vivían en el "Simulador Hotmart (QA)": pago aprobado,
 *                      demorado, disputa, reembolso, chargeback, cancelación,
 *                      mover próximo cobro). Cada uno = un mensaje editable.
 *  - `cobros`:         recordatorios automáticos de cobro (D-1, vencido, aviso de
 *                      pausa, pausada, reactivada).
 *  - `operativa`:      avisos operativos al negocio (reserva, domicilio, reseña).
 *
 * Cada plantilla tiene un `status`:
 *  - `active`:  hoy se envía de verdad; editar cambia el texto real (sin más).
 *  - `pending`: editable pero AÚN NO se envía (se cablea el envío en un paso
 *               posterior, OFF por defecto → "que nada afecte"). Aplica a los
 *               eventos que hoy no mandan ningún mensaje (reembolso, chargeback,
 *               cancelación, mover fecha) + la disputa (hoy comparte el de
 *               "pago demorado").
 *
 * PERSISTENCIA (sin migración): overrides en tabla `Setting`.
 *  - Override GLOBAL (todas las marcas): `sms.<id>`.
 *  - Override POR MARCA:                 `sms.wl.<whiteLabelId>.<id>`.
 * PRECEDENCIA al enviar: marca > global > default. Si nadie edita, texto idéntico
 * al hardcodeado (cero cambio de comportamiento).
 *
 * Carpetas personalizadas y la asignación workflow→carpeta se guardan por marca
 * (Setting `autom.folders.<wlId>` / `autom.assign.<wlId>`), gestionadas por
 * SuperAdminService — este archivo solo define las carpetas de sistema + defaults.
 */
import type { PrismaService } from '../common/prisma/prisma.service';
import { SMS_TEMPLATES, interpolateSms } from '../billing/sms-templates';

export type BrandMsgChannel = 'SMS' | 'WhatsApp' | 'PUSH';
export type BrandMsgStatus = 'active' | 'pending';

export type BrandMsgTemplateDef = {
  id: string;
  label: string;
  /** Nombre a mostrar dentro de su carpeta (ej. "Pago aprobado"). */
  folderLabel?: string;
  description: string;
  /** Tokens {token} disponibles en el texto. */
  vars: string[];
  default: string;
  /** Carpeta de sistema por defecto. */
  folder: string;
  status: BrandMsgStatus;
  channel: BrandMsgChannel;
  /** A quién le llega el mensaje (para mostrarlo en el panel). */
  audience: string;
};

/** Carpetas de sistema (siempre existen, en este orden). */
export const SYSTEM_FOLDERS: { id: string; name: string; system: true }[] = [
  { id: 'administrativa', name: 'Administrativa', system: true },
  { id: 'cobros', name: 'Cobros y recordatorios', system: true },
  { id: 'operativa', name: 'Operativas', system: true },
];

/** Texto por defecto del aviso de reseña baja (fuente única, la usa reviews). */
export const REVIEW_ALERT_DEFAULT =
  '⚠️ Nueva reseña privada en {businessName}\n\n' +
  'Cliente: {customerName}\n' +
  'Teléfono: {customerPhone}\n' +
  'Calificación: {rating}/5\n\n' +
  'Comentario:\n{feedback}\n\n' +
  'Revisar en {platform}:\n{feedbackUrl}';

/**
 * Carpeta y etiqueta de cada plantilla de COBRO (registro `SMS_TEMPLATES`,
 * grupo `cliente`). Pago aprobado/demorado se muestran en Administrativa (son
 * los que ya se envían en esos eventos); el resto son la secuencia de
 * recordatorios y viven en la carpeta Cobros.
 */
const BILLING_FOLDER: Record<string, { folder: string; folderLabel?: string }> = {
  payment_confirmed: { folder: 'administrativa', folderLabel: 'Pago aprobado' },
  payment_failed: { folder: 'administrativa', folderLabel: 'Pago demorado' },
  payment_reminder_7d: { folder: 'cobros' },
  payment_reminder_3d: { folder: 'cobros' },
  payment_reminder_tomorrow: { folder: 'cobros' },
  payment_due_today: { folder: 'cobros' },
  payment_overdue_reminder: { folder: 'cobros' },
  payment_not_processed_2d: { folder: 'cobros' },
  account_will_pause: { folder: 'cobros' },
  account_paused: { folder: 'cobros' },
  account_reactivated: { folder: 'cobros' },
};

/**
 * Plantillas ADMINISTRATIVAS nuevas (eventos que hoy NO mandan mensaje, + la
 * disputa). `status: 'pending'` → editables pero el envío se cablea aparte
 * (OFF por defecto). El texto default es solo un borrador de partida.
 */
export const ADMIN_TEMPLATES: BrandMsgTemplateDef[] = [
  {
    id: 'admin_protest',
    label: 'Pago en disputa',
    description:
      'El pago entró en disputa. Hoy comparte el aviso de "Pago demorado"; edítalo aquí si quieres un texto propio (se activará su envío en un paso posterior).',
    vars: ['platform', 'brandName'],
    folder: 'administrativa',
    status: 'pending',
    channel: 'SMS',
    audience: 'Al negocio',
    default:
      '{platform}: Tu pago de {brandName} está en revisión/disputa. Verifica tu medio de pago para no pausar tu cuenta.',
  },
  {
    id: 'admin_refunded',
    label: 'Reembolso',
    description:
      'Se procesó un reembolso (la cuenta se suspende). Hoy no se envía ningún mensaje; escríbelo y se activará su envío en un paso posterior.',
    vars: ['platform', 'brandName'],
    folder: 'administrativa',
    status: 'pending',
    channel: 'SMS',
    audience: 'Al negocio',
    default:
      '{platform}: Procesamos el reembolso de {brandName} y tu cuenta quedó suspendida. Escríbenos si necesitas ayuda.',
  },
  {
    id: 'admin_chargeback',
    label: 'Chargeback',
    description:
      'Se registró un contracargo (la cuenta se suspende). Hoy no se envía ningún mensaje; escríbelo y se activará su envío en un paso posterior.',
    vars: ['platform', 'brandName'],
    folder: 'administrativa',
    status: 'pending',
    channel: 'SMS',
    audience: 'Al negocio',
    default:
      '{platform}: Se registró un contracargo en {brandName} y tu cuenta quedó suspendida. Contáctanos para regularizar.',
  },
  {
    id: 'admin_cancellation',
    label: 'Cancelación',
    description:
      'Se canceló la suscripción (la cuenta se suspende suavemente). Hoy no se envía ningún mensaje; escríbelo y se activará su envío en un paso posterior.',
    vars: ['platform', 'brandName'],
    folder: 'administrativa',
    status: 'pending',
    channel: 'SMS',
    audience: 'Al negocio',
    default:
      '{platform}: Tu suscripción de {brandName} fue cancelada. Puedes reactivarla cuando quieras desde tu panel.',
  },
  {
    id: 'admin_charge_date_moved',
    label: 'Mover próximo cobro',
    description:
      'Se movió la fecha del próximo cobro. Hoy no se envía ningún mensaje; escríbelo y se activará su envío en un paso posterior.',
    vars: ['platform', 'brandName'],
    folder: 'administrativa',
    status: 'pending',
    channel: 'SMS',
    audience: 'Al negocio',
    default:
      '{platform}: Actualizamos la fecha de tu próximo cobro de {brandName}. Revísala en tu panel.',
  },
];

/**
 * Avisos operativos. El `default` reproduce EXACTAMENTE el texto que hoy arma
 * cada servicio; los fragmentos condicionales (zona, mesa, tel, dirección…) se
 * pre-calculan por el llamador como tokens `{...Line}` (ya incluyen su salto de
 * línea o quedan vacíos), para que editar nada deje la salida byte a byte igual.
 */
export const OPERATIONAL_TEMPLATES: BrandMsgTemplateDef[] = [
  {
    id: 'op_reservation_new',
    label: 'Reserva nueva',
    description: 'Aviso al negocio cuando un cliente crea una reserva pública.',
    vars: [
      'brandName',
      'customerName',
      'customerPhone',
      'party',
      'date',
      'time',
      'zoneLine',
      'tableLine',
      'notesLine',
    ],
    folder: 'operativa',
    status: 'active',
    channel: 'SMS',
    audience: 'Al negocio',
    default:
      '🔔 NUEVA RESERVA · {brandName}\n' +
      'Cliente: {customerName}\n' +
      '📞 {customerPhone}\n' +
      '👥 {party} personas\n' +
      '📅 {date} a las {time}{zoneLine}{tableLine}{notesLine}\n\n' +
      'Confirma manualmente con el cliente.',
  },
  {
    id: 'op_reservation_cancelled',
    label: 'Reserva cancelada por el cliente',
    description: 'Aviso al negocio cuando el cliente cancela su propia reserva.',
    vars: ['customerName', 'date', 'time', 'zoneLine', 'party', 'customerPhone'],
    folder: 'operativa',
    status: 'active',
    channel: 'SMS',
    audience: 'Al negocio',
    default:
      '❌ RESERVA CANCELADA POR EL CLIENTE\n' +
      '{customerName} canceló su reserva.\n' +
      '📅 {date} a las {time}{zoneLine} · {party} pax\n' +
      '📞 {customerPhone}\n' +
      'El slot vuelve a estar disponible.',
  },
  {
    id: 'op_delivery_alert',
    label: 'Aviso de domicilio',
    description:
      'Aviso al negocio por cada cambio del pedido a domicilio (creado, confirmado, listo, entregado). {eventLabel} es el encabezado del evento.',
    vars: [
      'eventLabel',
      'brandName',
      'code',
      'total',
      'customerName',
      'telLine',
      'addrLine',
      'payLine',
      'noteLine',
    ],
    folder: 'operativa',
    status: 'active',
    channel: 'SMS',
    audience: 'Al negocio',
    default:
      '{eventLabel}\n\n' +
      'Negocio: {brandName}\n' +
      'Pedido: #{code}\n' +
      'Total: {total}\n' +
      'Cliente: {customerName}\n' +
      '{telLine}{addrLine}{payLine}{noteLine}',
  },
  // PDF 1256 F3: notificaciones de pedido al CLIENTE final (opt-in por negocio,
  // OFF por defecto). Un mensaje por estado. `{trackingLine}`/`{etaLine}` los
  // pre-calcula el servicio (incluyen su propio prefijo/espacio o quedan vacíos)
  // para que editar el texto deje la salida consistente. SMS cortos = menor costo.
  {
    id: 'op_customer_order_created',
    label: 'Cliente · Pedido recibido',
    folderLabel: 'Pedido recibido',
    description:
      'SMS al CLIENTE cuando acaba de hacer su pedido. Solo se envía si el negocio activó las notificaciones al cliente para este evento.',
    vars: ['brandName', 'customerName', 'code', 'trackingLine'],
    folder: 'operativa',
    status: 'active',
    channel: 'SMS',
    audience: 'Al cliente',
    default:
      '🧾 {brandName}: recibimos tu pedido #{code}. Te avisamos cuando lo confirmemos.{trackingLine}',
  },
  {
    id: 'op_customer_order_confirmed',
    label: 'Cliente · Pedido confirmado',
    folderLabel: 'Pedido confirmado',
    description:
      'SMS al CLIENTE cuando el negocio confirma su pedido. Solo se envía si el negocio activó las notificaciones al cliente para este evento.',
    vars: ['brandName', 'customerName', 'code', 'trackingLine'],
    folder: 'operativa',
    status: 'active',
    channel: 'SMS',
    audience: 'Al cliente',
    default:
      '✅ {brandName}: confirmamos tu pedido #{code}. ¡Ya lo estamos preparando!{trackingLine}',
  },
  {
    id: 'op_customer_order_ready',
    label: 'Cliente · Pedido listo',
    folderLabel: 'Pedido listo',
    description:
      'SMS al CLIENTE cuando su pedido está listo (para recoger o despachar). Solo se envía si el negocio activó las notificaciones al cliente para este evento.',
    vars: ['brandName', 'customerName', 'code', 'trackingLine'],
    folder: 'operativa',
    status: 'active',
    channel: 'SMS',
    audience: 'Al cliente',
    default:
      '📦 {brandName}: tu pedido #{code} ya está listo.{trackingLine}',
  },
  {
    id: 'op_customer_order_on_the_way',
    label: 'Cliente · Pedido en camino',
    folderLabel: 'Pedido en camino',
    description:
      'SMS al CLIENTE cuando su domicilio sale en camino. Solo se envía si el negocio activó las notificaciones al cliente para este evento.',
    vars: ['brandName', 'customerName', 'code', 'etaLine', 'trackingLine'],
    folder: 'operativa',
    status: 'active',
    channel: 'SMS',
    audience: 'Al cliente',
    default:
      '🛵 {brandName}: tu pedido #{code} va en camino.{etaLine}{trackingLine}',
  },
  {
    id: 'op_customer_order_delivered',
    label: 'Cliente · Pedido entregado',
    folderLabel: 'Pedido entregado',
    description:
      'SMS al CLIENTE cuando su pedido fue entregado/completado. Solo se envía si el negocio activó las notificaciones al cliente para este evento.',
    vars: ['brandName', 'customerName', 'code'],
    folder: 'operativa',
    status: 'active',
    channel: 'SMS',
    audience: 'Al cliente',
    default:
      '🎉 {brandName}: tu pedido #{code} fue entregado. ¡Gracias por tu compra!',
  },
  {
    id: 'op_review_alert',
    label: 'Alerta de reseña baja',
    description:
      'Aviso al negocio cuando un cliente deja una reseña con calificación por debajo del umbral. Un negocio puede sobrescribirlo en sus ajustes (tiene prioridad sobre el de la marca).',
    vars: [
      'businessName',
      'customerName',
      'customerPhone',
      'rating',
      'feedback',
      'platform',
      'feedbackUrl',
    ],
    folder: 'operativa',
    status: 'active',
    channel: 'SMS',
    audience: 'Al negocio',
    default: REVIEW_ALERT_DEFAULT,
  },
];

/** Catálogo que ve el panel de la marca: cobros/administrativa + operativas. */
export function brandMsgCatalog(): BrandMsgTemplateDef[] {
  const billing: BrandMsgTemplateDef[] = SMS_TEMPLATES.filter(
    (t) => t.group === 'cliente',
  ).map((t) => {
    const f = BILLING_FOLDER[t.id] ?? { folder: 'cobros' };
    return {
      id: t.id,
      label: t.label,
      folderLabel: f.folderLabel,
      description: t.description,
      vars: t.vars,
      default: t.default,
      folder: f.folder,
      status: 'active',
      channel: 'SMS',
      audience: 'Al negocio',
    };
  });
  // Orden dentro de Administrativa: aprobado, demorado (de billing) → disputa,
  // reembolso, chargeback, cancelación, mover-fecha (admin) = 7.
  return [...billing, ...ADMIN_TEMPLATES, ...OPERATIONAL_TEMPLATES];
}

export function brandMsgTplKey(whiteLabelId: string, id: string): string {
  return `sms.wl.${whiteLabelId}.${id}`;
}
export function globalMsgTplKey(id: string): string {
  return `sms.${id}`;
}
// Stage 4 (PDF734): flag de ACTIVACIÓN de envío de las plantillas 'pending'
// (admin_*: reembolso, chargeback, cancelación, mover-fecha, disputa). Por
// marca (o global). Ausente/≠'true' = OFF.
export function brandMsgEnabledKey(whiteLabelId: string, id: string): string {
  return `sms.enabled.wl.${whiteLabelId}.${id}`;
}
export function globalMsgEnabledKey(id: string): string {
  return `sms.enabled.${id}`;
}

/**
 * ¿El ENVÍO de una plantilla está activado para esta marca? Las 'active'
 * (cobros/operativas) siempre envían. Las 'pending' (admin_*) están OFF por
 * defecto y solo envían si la marca (o global) las activó explícitamente.
 */
export async function isBrandTemplateSendEnabled(
  prisma: Pick<PrismaService, 'setting'>,
  id: string,
  whiteLabelId?: string | null,
): Promise<boolean> {
  const def = brandMsgCatalog().find((t) => t.id === id);
  if (!def) return false;
  if (def.status !== 'pending') return true;
  const keys = [globalMsgEnabledKey(id)];
  if (whiteLabelId) keys.unshift(brandMsgEnabledKey(whiteLabelId, id));
  const rows = await prisma.setting
    .findMany({ where: { key: { in: keys } } })
    .catch(() => [] as { key: string; value: string }[]);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  if (
    whiteLabelId &&
    byKey.get(brandMsgEnabledKey(whiteLabelId, id))?.trim() === 'true'
  ) {
    return true;
  }
  return byKey.get(globalMsgEnabledKey(id))?.trim() === 'true';
}

/**
 * Texto efectivo (SIN interpolar) de una plantilla: override de la marca >
 * override global > default del catálogo. Devuelve null si el id no existe.
 */
export async function resolveBrandTemplateText(
  prisma: Pick<PrismaService, 'setting'>,
  id: string,
  whiteLabelId?: string | null,
): Promise<string | null> {
  const def = brandMsgCatalog().find((t) => t.id === id);
  const fallback = def?.default ?? null;
  const keys = [globalMsgTplKey(id)];
  if (whiteLabelId) keys.unshift(brandMsgTplKey(whiteLabelId, id));
  const rows = await prisma.setting
    .findMany({ where: { key: { in: keys } } })
    .catch(() => [] as { key: string; value: string }[]);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  if (whiteLabelId) {
    const brand = byKey.get(brandMsgTplKey(whiteLabelId, id))?.trim();
    if (brand) return brand;
  }
  const global = byKey.get(globalMsgTplKey(id))?.trim();
  if (global) return global;
  return fallback;
}

/**
 * Resuelve + interpola una plantilla operativa. Lo usan reservations/orders que
 * pre-calculan sus vars (incluidos los fragmentos condicionales `{...Line}`).
 */
export async function resolveBrandTemplate(
  prisma: Pick<PrismaService, 'setting'>,
  opts: { id: string; whiteLabelId?: string | null; vars: Record<string, string> },
): Promise<string> {
  const tpl = (await resolveBrandTemplateText(prisma, opts.id, opts.whiteLabelId)) ?? '';
  return interpolateSms(tpl, opts.vars);
}

export { interpolateSms };
