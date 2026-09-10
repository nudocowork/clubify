// ── MOTOR DE EMAIL MARKETING — tipos + catálogos + helpers puros ──
// Audiencia: los CONTACTOS (leads/clientes) de la marca. Correo/SMS por la
// subcuenta del proveedor de la marca (envoltorio en provider/).

export type WFCondition = {
  field: string;
  op: 'eq' | 'neq' | 'contains' | 'filled';
  value?: string;
};

export type WFNode = {
  id: string;
  type: string;
  config: Record<string, unknown>;
  next?: string | null;
  yes?: string | null;
  no?: string | null;
};
export type WFGraph = Record<string, WFNode>;
export type WFTrigger = { type: string; filters?: WFCondition[]; [k: string]: unknown };
export type WFDrip = { enabled?: boolean; batchSize?: number; intervalMinutes?: number };
export type WFSendWindow = {
  enabled?: boolean;
  startHour?: number;
  endHour?: number;
  skipWeekends?: boolean;
  tz?: string;
};

// Disparadores contact-based. `manual` inscribe desde una lista.
export const MKT_TRIGGERS: { key: string; label: string; wired: boolean; hint?: string }[] = [
  { key: 'manual', label: 'Inscripción manual / lista', wired: true },
  { key: 'contact_created', label: 'Contacto nuevo', wired: true, hint: 'Al crearse un contacto nuevo en la marca.' },
  { key: 'tag_added', label: 'Etiqueta agregada', wired: true, hint: 'Cuando se le agrega una etiqueta al contacto (config: etiqueta).' },
  { key: 'email_reply', label: 'Responde / interactúa', wired: true, hint: 'Cuando el contacto responde, abre o hace clic en un correo.' },
  // ── Equipos de ventas ──
  // Cada evento es su propio disparador en vez de uno solo con un filtro,
  // porque «ganado» y «perdido» piden mensajes opuestos y esconderlos detrás
  // de una condición es la forma de mandarle el equivocado a alguien.
  { key: 'sales_lead_created', label: 'Lead nuevo (equipo de ventas)', wired: true, hint: 'Cuando entra un lead al tablero de un equipo, venga de donde venga.' },
  { key: 'sales_stage_changed', label: 'El lead cambia de columna', wired: true, hint: 'Al mover la tarjeta. Condición sobre «etapa» para una columna concreta.' },
  { key: 'sales_lead_won', label: 'Lead ganado', wired: true, hint: 'Al pasar a la columna de clientes.' },
  { key: 'sales_lead_lost', label: 'Lead perdido', wired: true, hint: 'Al pasar a la columna de no interesados.' },
  { key: 'sales_meeting_booked', label: 'Cita agendada', wired: true, hint: 'Cuando queda una cita, la ponga el vendedor o el propio prospecto.' },
  { key: 'sales_meeting_no_show', label: 'No asistió a la cita', wired: true, hint: 'Cuando el vendedor marca la cita como «no asistió».' },
];

export const MKT_NODE_TYPES: { key: string; label: string; branch?: boolean }[] = [
  { key: 'send_email', label: 'Enviar correo' },
  { key: 'send_sms', label: 'Enviar SMS' },
  { key: 'wait_delay', label: 'Espera (tiempo)' },
  { key: 'wait_datetime', label: 'Esperar hasta fecha/hora' },
  { key: 'wait_reply', label: 'Esperar respuesta' },
  { key: 'condition', label: 'Si / No (condición)', branch: true },
  { key: 'branch', label: 'Bifurcar', branch: true },
  { key: 'add_tag', label: 'Agregar etiqueta' },
  { key: 'webhook', label: 'Webhook' },
];

// Campos del contacto para condiciones.
export const MKT_FIELDS: { key: string; label: string }[] = [
  { key: 'nombre', label: 'Nombre' },
  { key: 'email', label: 'Correo' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'empresa', label: 'Empresa' },
  { key: 'tags', label: 'Etiquetas' },
  // Solo tienen valor en los disparadores de ventas. En los demás llegan
  // vacíos, y una condición sobre un campo vacío no casa — que es lo correcto:
  // un flujo de «contacto nuevo» no debería colarse por la etapa de un lead.
  { key: 'etapa', label: 'Columna del tablero (ventas)' },
  { key: 'equipo', label: 'Equipo de ventas' },
  { key: 'vendedor', label: 'Vendedor asignado (ventas)' },
];

export const MKT_MERGE_FIELDS: { key: string; label: string }[] = [
  { key: 'nombre', label: 'Nombre del contacto' },
  { key: 'email', label: 'Correo' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'empresa', label: 'Empresa' },
  { key: 'marca', label: 'Nombre de la marca' },
  { key: 'etapa', label: 'Columna del tablero (ventas)' },
  { key: 'equipo', label: 'Equipo de ventas' },
  { key: 'vendedor', label: 'Vendedor asignado (ventas)' },
];

/** Reemplaza {{campo}} por su valor del contexto (vacío si no existe). */
export function resolveMerge(text: string, ctx: Record<string, string>): string {
  return (text || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => {
    const key = String(k).trim();
    return ctx[key] != null ? ctx[key] : '';
  });
}

/**
 * Versión en texto plano de un correo HTML, para la parte `text` del envío.
 *
 * Se deriva del HTML (y no de los bloques) a propósito: el HTML es lo único
 * que tienen TODAS las plantillas —incluidas las importadas de otra
 * herramienta, que llegan sin bloques que recorrer—. Un correo solo-HTML
 * puntúa peor en los filtros antispam y no se lee en clientes sin HTML.
 */
export function htmlToText(html: string): string {
  return String(html || '')
    // Primero los comentarios: se lleva el VML de Outlook y los condicionales.
    // Al ser no-codicioso, `<!--[if !mso]><!-- -->` desaparece entero y deja
    // dentro el <a> real, que es justo lo que queremos conservar.
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Relleno invisible del preheader: si no se quita, el texto plano empieza
    // con una tira de caracteres raros.
    .replace(/&#8199;|&#65279;|&#847;|&zwnj;/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|td)>/gi, '\n')
    .replace(/<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, txt: string) => {
      const etiqueta = txt.replace(/<[^>]+>/g, '').trim();
      const url = String(href).trim();
      if (!url || url === '#') return etiqueta;
      return etiqueta && etiqueta !== url ? `${etiqueta}: ${url}` : url;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Evalúa condiciones contra el contexto del contacto. */
export function evalWF(
  conditions: WFCondition[] | undefined,
  ctx: Record<string, string>,
  match: 'all' | 'any' = 'all',
): boolean {
  if (!conditions || !conditions.length) return true;
  const test = (c: WFCondition): boolean => {
    const v = String(ctx[c.field] ?? '').toLowerCase().trim();
    const target = String(c.value ?? '').toLowerCase().trim();
    switch (c.op) {
      case 'eq':
        return v === target;
      case 'neq':
        return v !== target;
      case 'contains':
        return v.includes(target);
      case 'filled':
        return v !== '';
      default:
        return true;
    }
  };
  return match === 'all' ? conditions.every(test) : conditions.some(test);
}

/**
 * Backoff de reintentos en minutos: reintento #1 → 2, #2 → 5, #3 → 15.
 * `attempts` = envíos ya hechos (incluye el inicial). El 1er envío fallido
 * (attempts=1) programa el reintento #1. Total: 1 inicial + 3 reintentos ("N/3").
 */
export const RETRY_BACKOFF_MIN = [2, 5, 15];
export const MAX_ATTEMPTS = 1 + RETRY_BACKOFF_MIN.length; // 4

/** Minutos hasta el próximo reintento tras `attempts` envíos. null si se agotó. */
export function backoffMinutes(attempts: number): number | null {
  if (attempts < 1 || attempts >= MAX_ATTEMPTS) return null;
  return RETRY_BACKOFF_MIN[attempts - 1] ?? null;
}
