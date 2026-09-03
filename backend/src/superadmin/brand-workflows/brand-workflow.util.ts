// ── MOTOR DE WORKFLOWS DE MARCA — tipos + catálogos + helpers puros ──
// Audiencia: los NEGOCIOS (Tenant) de la marca. El SMS va al dueño por la
// subcuenta de Grow Business de la marca.

export type WFCondition = {
  field: string;
  op: 'eq' | 'neq' | 'contains' | 'filled';
  value?: string;
};

export type WFNode = {
  id: string;
  type: string; // send_sms | wait_delay | if_else | end
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

// Disparadores. Todos cableados (Fase 3): el motor escanea cada hora e inscribe
// automáticamente. `manual` se inscribe desde la pestaña Inscribir.
export const WF_TRIGGERS: { key: string; label: string; wired: boolean; hint?: string }[] = [
  { key: 'manual', label: 'Inscripción manual / lista', wired: true },
  { key: 'business_created', label: 'Negocio nuevo', wired: true, hint: 'Al registrarse un negocio nuevo en la marca.' },
  {
    key: 'subscription_expiring',
    label: 'Suscripción por vencer',
    wired: true,
    hint: 'Cuando faltan N días para el próximo cobro (config: días antes).',
  },
  {
    key: 'business_inactive',
    label: 'Negocio inactivo',
    wired: true,
    hint: 'Negocio activo sin pedidos en los últimos N días (config: días inactivo).',
  },
];

export const WF_NODE_TYPES: { key: string; label: string; branch?: boolean }[] = [
  { key: 'send_sms', label: 'Enviar SMS' },
  { key: 'wait_delay', label: 'Espera (tiempo)' },
  { key: 'if_else', label: 'Si / No (condición)', branch: true },
  { key: 'end', label: 'Terminar' },
];

// Campos del negocio para condiciones + merge.
export const WF_FIELDS: { key: string; label: string }[] = [
  { key: 'plan', label: 'Plan' },
  { key: 'status', label: 'Estado de la cuenta' },
  { key: 'negocio', label: 'Nombre del negocio' },
];

export const WF_MERGE_FIELDS: { key: string; label: string }[] = [
  { key: 'negocio', label: 'Nombre del negocio' },
  { key: 'owner', label: 'Nombre del dueño' },
  { key: 'plan', label: 'Plan' },
  { key: 'platform', label: 'Nombre de la marca' },
];

export function resolveMerge(text: string, ctx: Record<string, string>): string {
  return (text || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => {
    const key = String(k).trim();
    return ctx[key] != null ? ctx[key] : '';
  });
}

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
