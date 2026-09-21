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
  type: string; // ver WF_NODE_TYPES
  config: Record<string, unknown>;
  next?: string | null;
  yes?: string | null;
  no?: string | null;
  /** Una salida por ruta, para los pasos que abren N ramas (`split`). */
  branches?: Record<string, string | null>;
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

/**
 * CATÁLOGO ÚNICO del constructor de marca.
 *
 * Hasta el 2026-09-21 esto no lo importaba nadie: el catálogo de verdad vivía
 * copiado a mano en `BrandWorkflowsPanel.tsx`, así que backend y pantalla se
 * desincronizaron (aquí faltaba hasta `send_email`, que lleva meses enviando).
 * Ahora la pantalla lo pide por `GET /admin/workflows/catalogo` y esto es lo
 * único que hay que tocar para añadir un disparador o un paso.
 *
 * Cada campo trae lo que la pantalla necesita para dibujar su formulario sola.
 */
export type CampoDeConfig = {
  key: string;
  label: string;
  /** Qué control pinta la pantalla. `condiciones`, `rutas` y `cabeceras` son editores propios. */
  tipo: 'texto' | 'textarea' | 'numero' | 'select' | 'fechaHora' | 'condiciones' | 'rutas' | 'cabeceras' | 'flujo';
  opciones?: { value: string; label: string }[];
  def?: string | number;
  ayuda?: string;
  /** Sin esto el paso no se puede guardar. */
  requerido?: boolean;
};

export type DisparadorDeMarca = {
  key: string;
  label: string;
  grupo: 'General' | 'Ciclo de vida' | 'Cobro' | 'Actividad';
  /** Cada cuánto se mira: los de cobro van en el barrido de 5 minutos; el resto, cada hora. */
  latencia: 'minutos' | 'hora';
  hint?: string;
  campos?: CampoDeConfig[];
};

export type PasoDeMarca = {
  key: string;
  label: string;
  grupo: 'Mensaje' | 'Espera' | 'Lógica' | 'Integración' | 'Salida';
  icono: string;
  /** Cómo se dibuja debajo: una salida, Sí/No, o una por ruta. */
  ramas?: 'siNo' | 'rutas';
  hint?: string;
  campos: CampoDeConfig[];
};

const UNIDADES = [
  { value: 'minutes', label: 'minutos' },
  { value: 'hours', label: 'horas' },
  { value: 'days', label: 'días' },
  { value: 'weeks', label: 'semanas' },
];

export const WF_TRIGGERS: DisparadorDeMarca[] = [
  { key: 'manual', label: 'Inscripción manual / lista', grupo: 'General', latencia: 'minutos', hint: 'Los metes tú desde la pestaña «Inscribir».' },

  // ── Ciclo de vida del negocio ──
  { key: 'business_created', label: 'Negocio nuevo', grupo: 'Ciclo de vida', latencia: 'hora', hint: 'Al registrarse un negocio nuevo en la marca.' },
  { key: 'business_suspended', label: 'Negocio suspendido', grupo: 'Ciclo de vida', latencia: 'minutos', hint: 'Cuando la cuenta se pausa por falta de pago o por cancelación.' },
  {
    key: 'trial_ending',
    label: 'Prueba por terminar',
    grupo: 'Ciclo de vida',
    latencia: 'hora',
    hint: 'Cuando faltan N días para que se acabe la prueba.',
    campos: [{ key: 'daysBefore', label: 'Días antes', tipo: 'numero', def: 2 }],
  },

  // ── Cobro ──
  {
    key: 'subscription_expiring',
    label: 'Suscripción por vencer',
    grupo: 'Cobro',
    latencia: 'hora',
    hint: 'Cuando faltan N días para el próximo cobro.',
    campos: [{ key: 'daysBefore', label: 'Días antes', tipo: 'numero', def: 3 }],
  },
  { key: 'payment_approved', label: 'Pago aprobado', grupo: 'Cobro', latencia: 'minutos', hint: 'Cada vez que entra un pago del negocio.' },
  { key: 'payment_failed', label: 'Pago rechazado o demorado', grupo: 'Cobro', latencia: 'minutos' },
  { key: 'payment_refunded', label: 'Reembolso o contracargo', grupo: 'Cobro', latencia: 'minutos', hint: 'La pasarela devolvió el dinero de un pago.' },
  { key: 'subscription_cancelled', label: 'Suscripción cancelada', grupo: 'Cobro', latencia: 'minutos', hint: 'El negocio canceló su suscripción.' },

  // ── Actividad del negocio ──
  {
    key: 'business_inactive',
    label: 'Negocio inactivo',
    grupo: 'Actividad',
    latencia: 'hora',
    hint: 'Negocio activo sin pedidos en los últimos N días.',
    campos: [{ key: 'daysInactive', label: 'Días sin pedidos', tipo: 'numero', def: 30 }],
  },
  { key: 'first_order', label: 'Primer pedido', grupo: 'Actividad', latencia: 'hora', hint: 'El negocio recibió su primer pedido: ya está usando el producto.' },
  {
    key: 'orders_milestone',
    label: 'Llegó a N pedidos',
    grupo: 'Actividad',
    latencia: 'hora',
    hint: 'Para felicitar o para ofrecer un plan mayor.',
    campos: [{ key: 'orders', label: 'Pedidos', tipo: 'numero', def: 100 }],
  },
];

export const WF_NODE_TYPES: PasoDeMarca[] = [
  // ── Mensaje ──
  {
    key: 'send_sms',
    label: 'Enviar mensaje',
    grupo: 'Mensaje',
    icono: '💬',
    hint: 'SMS al dueño del negocio, por la subcuenta de la marca.',
    campos: [{ key: 'message', label: 'Mensaje', tipo: 'textarea', requerido: true, ayuda: 'Admite {{negocio}}, {{owner}}, {{plan}}…' }],
  },
  {
    key: 'send_email',
    label: 'Enviar correo',
    grupo: 'Mensaje',
    icono: '✉️',
    hint: 'Al correo del dueño, por la subcuenta de la marca. El cuerpo va tal cual: admite HTML.',
    campos: [
      { key: 'subject', label: 'Asunto', tipo: 'texto', requerido: true },
      { key: 'body', label: 'Cuerpo', tipo: 'textarea', requerido: true },
    ],
  },
  {
    key: 'notify_brand',
    label: 'Avisar al equipo',
    grupo: 'Mensaje',
    icono: '🔔',
    hint: 'A vosotros, no al negocio: para enteraros de lo que pasa con un cliente.',
    campos: [
      {
        key: 'canal',
        label: 'Por dónde',
        tipo: 'select',
        def: 'sms',
        opciones: [
          { value: 'sms', label: 'SMS' },
          { value: 'email', label: 'Correo' },
        ],
      },
      { key: 'to', label: 'Teléfono o correo', tipo: 'texto', requerido: true, ayuda: 'A quién del equipo le llega.' },
      { key: 'message', label: 'Aviso', tipo: 'textarea', requerido: true },
    ],
  },

  // ── Espera ──
  {
    key: 'wait_delay',
    label: 'Esperar un tiempo',
    grupo: 'Espera',
    icono: '⏱',
    campos: [
      { key: 'amount', label: 'Cuánto', tipo: 'numero', def: 1 },
      { key: 'unit', label: 'Unidad', tipo: 'select', def: 'days', opciones: UNIDADES },
    ],
  },
  {
    key: 'wait_datetime',
    label: 'Esperar hasta una fecha',
    grupo: 'Espera',
    icono: '📆',
    hint: 'Para campañas con día y hora fijos. Si la fecha ya pasó, sigue de largo.',
    campos: [{ key: 'datetime', label: 'Fecha y hora', tipo: 'fechaHora', requerido: true }],
  },

  // ── Lógica ──
  {
    key: 'if_else',
    label: 'Si / No',
    grupo: 'Lógica',
    icono: '🔀',
    ramas: 'siNo',
    campos: [
      { key: 'conditions', label: 'Condiciones', tipo: 'condiciones', ayuda: 'Sin condiciones, siempre va por «Sí».' },
      {
        key: 'match',
        label: 'Se cumple si',
        tipo: 'select',
        def: 'all',
        opciones: [
          { value: 'all', label: 'se cumplen todas' },
          { value: 'any', label: 'se cumple alguna' },
        ],
      },
    ],
  },
  {
    key: 'split',
    label: 'Dividir (A/B por %)',
    grupo: 'Lógica',
    icono: '⋔',
    ramas: 'rutas',
    hint: 'Para probar dos mensajes y ver cuál funciona mejor.',
    campos: [{ key: 'routes', label: 'Rutas', tipo: 'rutas', requerido: true }],
  },

  // ── Integración ──
  {
    key: 'webhook',
    label: 'Llamar a un webhook',
    grupo: 'Integración',
    icono: '🌐',
    hint: 'Avisa a otro sistema. El cuerpo por defecto lleva los datos del negocio.',
    campos: [
      { key: 'url', label: 'URL', tipo: 'texto', requerido: true },
      {
        key: 'method',
        label: 'Método',
        tipo: 'select',
        def: 'POST',
        opciones: [
          { value: 'POST', label: 'POST' },
          { value: 'GET', label: 'GET' },
          { value: 'PUT', label: 'PUT' },
        ],
      },
      { key: 'headers', label: 'Cabeceras', tipo: 'cabeceras' },
      { key: 'body', label: 'Cuerpo (JSON)', tipo: 'textarea', ayuda: 'Vacío = los datos del negocio.' },
    ],
  },
  {
    key: 'goto_workflow',
    label: 'Pasar a otro flujo',
    grupo: 'Integración',
    icono: '➡️',
    hint: 'Saca al negocio de este flujo y lo mete en otro.',
    campos: [{ key: 'workflowId', label: 'Flujo destino', tipo: 'flujo', requerido: true }],
  },

  // ── Salida ──
  { key: 'end', label: 'Terminar el flujo', grupo: 'Salida', icono: '🚪', campos: [] },
];

// Campos del negocio para condiciones + merge.
export const WF_FIELDS: { key: string; label: string }[] = [
  { key: 'plan', label: 'Plan' },
  { key: 'periodicidad', label: 'Periodicidad' },
  { key: 'status', label: 'Estado de la cuenta' },
  { key: 'negocio', label: 'Nombre del negocio' },
  { key: 'categoria', label: 'Categoría del negocio' },
  { key: 'pedidos', label: 'Pedidos totales' },
];

export const WF_MERGE_FIELDS: { key: string; label: string }[] = [
  { key: 'negocio', label: 'Nombre del negocio' },
  { key: 'owner', label: 'Nombre del dueño' },
  { key: 'plan', label: 'Plan' },
  { key: 'periodicidad', label: 'Periodicidad' },
  { key: 'vence', label: 'Fecha del próximo cobro' },
  { key: 'prueba_termina', label: 'Fin de la prueba' },
  { key: 'pedidos', label: 'Pedidos totales' },
  { key: 'platform', label: 'Nombre de la marca' },
];

/** Los disparadores de cobro solo existen donde sabemos leer los avisos. */
const COBRO_POR_PASARELA: Record<string, boolean> = { HOTMART: true, STRIPE: true };
const DISPARADORES_DE_COBRO = ['payment_approved', 'payment_failed', 'payment_refunded', 'subscription_cancelled'];

/**
 * Lo que la pantalla necesita para dibujarse entera.
 *
 * `pasarela` es la de la MARCA. Si no sabemos leer sus cobros (pago manual,
 * Cross…), los cuatro disparadores de cobro NO se ofrecen: enseñar «Pago
 * aprobado · entra en minutos» a quien nunca lo va a ver es prometer algo que
 * no existe, que es el defecto que más veces hemos tenido aquí.
 */
export function catalogoDeMarca(pasarela?: string | null) {
  const puedeCobro = !!pasarela && COBRO_POR_PASARELA[String(pasarela).toUpperCase()] === true;
  const disparadores = puedeCobro
    ? WF_TRIGGERS
    : WF_TRIGGERS.filter((d) => !DISPARADORES_DE_COBRO.includes(d.key));
  return {
    disparadores,
    pasos: WF_NODE_TYPES,
    campos: WF_FIELDS,
    merge: WF_MERGE_FIELDS,
    operadores: [
      { value: 'eq', label: 'es igual a' },
      { value: 'neq', label: 'no es' },
      { value: 'contains', label: 'contiene' },
      { value: 'filled', label: 'tiene algo' },
    ],
  };
}

/**
 * ¿La URL del webhook apunta a nuestra propia red?
 *
 * Quien configura un flujo es el administrador de una marca —un cliente, no
 * alguien de casa—, y el servidor sí puede hablar con la red interna de
 * Railway. Sin esto, un webhook podría usarse para curiosear ahí dentro.
 */
export function destinoInterno(url: string): boolean {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true; // si no se puede ni leer, no se llama
  }
  if (host === 'localhost' || host.endsWith('.internal') || host.endsWith('.local')) return true;
  if (host === '[::1]' || host === '::1') return true;
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return (
    a === 127 || // loopback
    a === 10 || // privada
    (a === 172 && b >= 16 && b <= 31) || // privada
    (a === 192 && b === 168) || // privada
    (a === 169 && b === 254) || // enlace local (metadatos de la nube)
    a === 0
  );
}

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
