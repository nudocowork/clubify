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
];

export const MKT_MERGE_FIELDS: { key: string; label: string }[] = [
  { key: 'nombre', label: 'Nombre del contacto' },
  { key: 'email', label: 'Correo' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'empresa', label: 'Empresa' },
  { key: 'marca', label: 'Nombre de la marca' },
];

/** Reemplaza {{campo}} por su valor del contexto (vacío si no existe). */
export function resolveMerge(text: string, ctx: Record<string, string>): string {
  return (text || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => {
    const key = String(k).trim();
    return ctx[key] != null ? ctx[key] : '';
  });
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
