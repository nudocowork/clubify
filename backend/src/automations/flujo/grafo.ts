/**
 * Núcleo PURO del constructor visual de automatizaciones de un negocio.
 *
 * Aquí no hay base de datos: tipos, catálogo de lo que se puede usar, la
 * conversión de los flujos de antes y la validación. Lo usan el motor
 * (`flujos.service.ts`), el controlador y las pruebas. Que el catálogo salga de
 * aquí, por HTTP, es a propósito: en el constructor de marca estaba copiado a
 * mano en el front y se desincronizó ([[clubify-workflows-de-marca]]).
 */

export const VERSION_GRAFO = 2;

// ───────────────────────── Disparadores ─────────────────────────

/**
 * Solo eventos que el código EMITE de verdad (`automations.emit(...)` en
 * passes, stamps, orders y los crons de cumpleaños e inactividad).
 * `COUPON_ISSUED` no es un evento propio: es PASS_CREATED cuando la tarjeta es
 * un cupón, descuento o regalo, y se reconoce al inscribir.
 */
export const DISPARADORES = [
  { tipo: 'PASS_CREATED', categoria: 'fidelizacion', disponible: true },
  { tipo: 'COUPON_ISSUED', categoria: 'cupones', disponible: true },
  { tipo: 'STAMP_ADDED', categoria: 'fidelizacion', disponible: true },
  { tipo: 'NEAR_REWARD', categoria: 'fidelizacion', disponible: true },
  { tipo: 'PASS_COMPLETED', categoria: 'recompensas', disponible: true },
  { tipo: 'REWARD_REDEEMED', categoria: 'recompensas', disponible: true },
  { tipo: 'COUPON_REDEEMED', categoria: 'cupones', disponible: true },
  { tipo: 'BIRTHDAY', categoria: 'cumpleanos', disponible: true },
  { tipo: 'INACTIVITY', categoria: 'retencion', disponible: true, conDias: true },
  { tipo: 'ORDER_CREATED', categoria: 'pedidos', disponible: true },
  { tipo: 'ORDER_CONFIRMED', categoria: 'pedidos', disponible: true },
  { tipo: 'ORDER_DELIVERED', categoria: 'pedidos', disponible: true },
  { tipo: 'ORDER_RATED', categoria: 'pedidos', disponible: true },
  // No disponibles: se muestran como «pendiente de integración» y no se pueden
  // activar. GEO_ENTER no existe en ningún sitio: el aviso por cercanía lo
  // decide el teléfono y Clubify nunca se entera de que el cliente pasó cerca.
  // Un flujo de Extreme House lo usaba y no corrió nunca.
  { tipo: 'GEO_ENTER', categoria: 'proximidad', disponible: false },
  { tipo: 'SPECIFIC_DATE', categoria: 'fechas', disponible: false },
] as const;

export type TipoDisparador = (typeof DISPARADORES)[number]['tipo'];

export function disparador(tipo: string) {
  return DISPARADORES.find((d) => d.tipo === tipo);
}

/** Tarjetas que, al emitirse, cuentan como «cupón emitido». */
export const TIPOS_DE_CUPON = ['COUPON', 'DISCOUNT', 'GIFT'];

/**
 * Las altas a una tarjeta solo se saludan por push (Javier, 2026-11-09): un SMS
 * saldría por la línea de la marca a alguien que solo se inscribió.
 * `executeAction` lo descarta igual; aquí se avisa al configurar.
 */
export const DISPARADORES_SOLO_PUSH = ['PASS_CREATED', 'COUPON_ISSUED'];

// ───────────────────────── Nodos ─────────────────────────

export type TipoNodo = 'wait' | 'push' | 'sms' | 'whatsapp' | 'condition' | 'end';
export const TIPOS_NODO: TipoNodo[] = ['wait', 'push', 'sms', 'whatsapp', 'condition', 'end'];
export const NODOS_DE_ENVIO: TipoNodo[] = ['push', 'sms', 'whatsapp'];

export type UnidadEspera = 'minutes' | 'hours' | 'days' | 'weeks';
export const MS_UNIDAD: Record<UnidadEspera, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 7 * 86_400_000,
};

export type Nodo = {
  id: string;
  type: TipoNodo;
  config: Record<string, any>;
  /** Siguiente paso (todos menos condición y fin). */
  next?: string | null;
  /** Ramas de la condición. */
  yes?: string | null;
  no?: string | null;
};

export type Grafo = { rootId: string | null; nodes: Record<string, Nodo> };

// ───────────────────────── Límites ─────────────────────────

export const LIMITES = {
  nodos: 60,
  esperas: 25,
  /** Ninguna espera suelta ni la suma de un camino pasa de un año. */
  esperaMaxMs: 365 * 86_400_000,
  esperaMinMs: 60_000,
  tituloPush: 40,
  cuerpoPush: 180,
  cuerpoSms: 480,
  /** Mensajes de flujos por cliente y día, sumando todos los flujos. */
  mensajesPorClienteDia: 3,
  /** Nodos que un tick ejecuta seguidos antes de soltar (anti-bucle). */
  pasosPorTick: 40,
  diasInactividadMin: 1,
  diasInactividadMax: 365,
};

// ───────────────────────── Condiciones ─────────────────────────

export type TipoDato = 'number' | 'boolean';

/**
 * Campos de condición. Todos se calculan en el momento de evaluar, contra la
 * base, del cliente que va en el recorrido y solo dentro de su negocio.
 */
export const CAMPOS_CONDICION: Array<{ campo: string; tipo: TipoDato }> = [
  { campo: 'sellos_actuales', tipo: 'number' },
  { campo: 'sellos_faltantes', tipo: 'number' },
  { campo: 'dias_desde_ultima_visita', tipo: 'number' },
  { campo: 'dias_desde_visita_anterior', tipo: 'number' },
  { campo: 'visitas_totales', tipo: 'number' },
  { campo: 'pedidos_totales', tipo: 'number' },
  { campo: 'tuvo_sello_desde_que_entro', tipo: 'boolean' },
  { campo: 'canjeo_desde_que_entro', tipo: 'boolean' },
  { campo: 'premio_disponible', tipo: 'boolean' },
  { campo: 'cupon_activo', tipo: 'boolean' },
  { campo: 'beneficio_disponible', tipo: 'boolean' },
  { campo: 'tiene_cumpleanos', tipo: 'boolean' },
];

export const OPERADORES: Record<TipoDato, string[]> = {
  number: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'empty', 'not_empty'],
  boolean: ['is_true', 'is_false'],
};
const SIN_VALOR = new Set(['empty', 'not_empty', 'is_true', 'is_false']);

export function campoCondicion(campo: string) {
  return CAMPOS_CONDICION.find((c) => c.campo === campo);
}

/**
 * Evalúa una condición. `valor` null = el dato no existe (nunca visitó, sin
 * tarjeta…): solo «está vacío» lo acepta, ningún «mayor que» lo da por bueno.
 */
export function evaluarCondicion(
  op: string,
  valor: number | boolean | null,
  esperado?: unknown,
): boolean {
  if (op === 'empty') return valor === null || valor === undefined;
  if (op === 'not_empty') return valor !== null && valor !== undefined;
  if (op === 'is_true') return valor === true;
  if (op === 'is_false') return valor !== true;
  if (valor === null || valor === undefined) return false;
  const a = Number(valor);
  const b = Number(esperado);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  switch (op) {
    case 'eq':
      return a === b;
    case 'neq':
      return a !== b;
    case 'gt':
      return a > b;
    case 'lt':
      return a < b;
    case 'gte':
      return a >= b;
    case 'lte':
      return a <= b;
    default:
      // Un operador desconocido NUNCA da verdadero: en el motor de marca
      // devolvía true y dejaba pasar a todo el mundo.
      return false;
  }
}

// ───────────────────────── Variables ─────────────────────────

/** Las que el motor rellena en cada envío (ver `variablesDelCliente`). */
export const VARIABLES = [
  'customerName',
  'nombre',
  'businessName',
  'cardName',
  'rewardText',
  'stampsCount',
  'remaining',
];

export function variablesDesconocidas(texto: string): string[] {
  const out: string[] = [];
  for (const m of String(texto ?? '').matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    if (!VARIABLES.includes(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// ───────────────────────── Flujos de antes ─────────────────────────

/**
 * Un flujo de la versión 1 es una lista `steps`. Se convierte a grafo lineal
 * con ids `s0`, `s1`… para que una inscripción vieja que iba por el paso k
 * (`stepIndex`) siga exactamente en el nodo `s{k}`.
 */
export function grafoDeLista(steps: any[]): Grafo {
  const nodes: Record<string, Nodo> = {};
  const lista = Array.isArray(steps) ? steps : [];
  lista.forEach((s, i) => {
    const id = `s${i}`;
    const next = i + 1 < lista.length ? `s${i + 1}` : null;
    if (s?.type === 'WAIT') {
      nodes[id] = {
        id,
        type: 'wait',
        config: { amount: Number(s.amount) || 1, unit: s.unit || 'days' },
        next,
      };
    } else if (s?.type === 'SEND_PUSH') {
      nodes[id] = { id, type: 'push', config: { title: s.title ?? '', body: s.body ?? '' }, next };
    } else if (s?.type === 'SEND_WHATSAPP') {
      nodes[id] = { id, type: 'whatsapp', config: { body: s.body ?? '' }, next };
    } else {
      nodes[id] = { id, type: 'sms', config: { body: s?.body ?? '' }, next };
    }
  });
  return { rootId: lista.length ? 's0' : null, nodes };
}

/** El grafo que manda para un flujo, sea de la versión que sea. */
export function grafoDelFlujo(wf: { schemaVersion?: number | null; graph?: any; steps?: any }): Grafo {
  if ((wf.schemaVersion ?? 1) >= VERSION_GRAFO) {
    const g = (wf.graph ?? {}) as Partial<Grafo>;
    return { rootId: g.rootId ?? null, nodes: (g.nodes as any) ?? {} };
  }
  return grafoDeLista(wf.steps as any[]);
}

/** Nodo en el que va una inscripción (las viejas solo guardaban `stepIndex`). */
export function nodoActual(enr: { currentNodeId?: string | null; stepIndex?: number | null }) {
  return enr.currentNodeId ?? `s${enr.stepIndex ?? 0}`;
}

// ───────────────────────── Validación ─────────────────────────

export type Problema = { nodeId?: string; campo?: string; codigo: string; extra?: Record<string, any> };

export type DefinicionFlujo = {
  name: string;
  triggerType: string;
  triggerDays?: number | null;
  triggerConfig?: Record<string, any>;
  graph: Grafo;
  reentry?: string;
};

export type ContextoValidacion = {
  /** ¿El negocio tiene por dónde mandar SMS / WhatsApp (línea propia o de su marca)? */
  smsDisponible: boolean;
  /** Tarjetas del negocio (para el filtro «solo esta tarjeta»). */
  tarjetas?: string[];
};

/**
 * Forma: lo mínimo para GUARDAR un borrador. Un borrador puede estar a medias
 * (sin mensaje, sin disparador), pero nunca roto: referencias a nodos que no
 * existen, ciclos o tipos inventados no se guardan, porque el motor no sabría
 * qué hacer con ellos.
 */
export function problemasDeForma(g: Grafo): Problema[] {
  const out: Problema[] = [];
  const nodes = g?.nodes ?? {};
  const ids = Object.keys(nodes);
  if (ids.length > LIMITES.nodos) out.push({ codigo: 'demasiados_nodos', extra: { max: LIMITES.nodos } });
  if (g.rootId && !nodes[g.rootId]) out.push({ codigo: 'raiz_inexistente' });
  for (const id of ids) {
    const n = nodes[id];
    if (!n || n.id !== id) {
      out.push({ nodeId: id, codigo: 'nodo_mal_formado' });
      continue;
    }
    if (!TIPOS_NODO.includes(n.type)) out.push({ nodeId: id, codigo: 'tipo_desconocido' });
    const refs = n.type === 'condition' ? [n.yes, n.no] : [n.next];
    for (const r of refs) if (r && !nodes[r]) out.push({ nodeId: id, codigo: 'conexion_invalida' });
    if (n.type === 'end' && n.next) out.push({ nodeId: id, codigo: 'fin_con_siguiente' });
  }
  // Ciclos y nodos con dos padres: el grafo tiene que ser un árbol. Un ciclo con
  // una espera dentro es un flujo que no termina nunca y escribe para siempre.
  const padres = new Map<string, number>();
  for (const n of Object.values(nodes)) {
    for (const r of n.type === 'condition' ? [n.yes, n.no] : [n.next]) {
      if (r) padres.set(r, (padres.get(r) ?? 0) + 1);
    }
  }
  for (const [id, c] of padres) if (c > 1) out.push({ nodeId: id, codigo: 'dos_entradas' });
  if (g.rootId && padres.has(g.rootId)) out.push({ nodeId: g.rootId, codigo: 'ciclo' });
  const vistos = new Set<string>();
  const pila: string[] = g.rootId ? [g.rootId] : [];
  while (pila.length) {
    const id = pila.pop()!;
    if (vistos.has(id)) {
      out.push({ nodeId: id, codigo: 'ciclo' });
      continue;
    }
    vistos.add(id);
    const n = nodes[id];
    if (!n) continue;
    for (const r of n.type === 'condition' ? [n.yes, n.no] : [n.next]) if (r) pila.push(r);
  }
  for (const id of ids) if (!vistos.has(id)) out.push({ nodeId: id, codigo: 'desconectado' });
  return dedupe(out);
}

/** Todo lo que impide ACTIVAR. Vacío = se puede activar. */
export function problemasParaActivar(def: DefinicionFlujo, ctx: ContextoValidacion): Problema[] {
  const out = problemasDeForma(def.graph);
  if (!def.name?.trim()) out.push({ campo: 'name', codigo: 'sin_nombre' });

  const d = disparador(def.triggerType);
  if (!d) out.push({ campo: 'trigger', codigo: 'sin_disparador' });
  else if (!d.disponible) out.push({ campo: 'trigger', codigo: 'disparador_no_disponible' });
  if (d && 'conDias' in d && d.conDias) {
    const dias = Number(def.triggerDays);
    if (!Number.isInteger(dias) || dias < LIMITES.diasInactividadMin || dias > LIMITES.diasInactividadMax) {
      out.push({ campo: 'triggerDays', codigo: 'dias_invalidos' });
    }
  }
  const cardId = def.triggerConfig?.cardId;
  if (cardId && ctx.tarjetas && !ctx.tarjetas.includes(cardId)) {
    out.push({ campo: 'trigger', codigo: 'tarjeta_ajena' });
  }
  if (!['once', 'after_finish'].includes(def.reentry ?? 'once')) {
    out.push({ campo: 'reentry', codigo: 'reentrada_invalida' });
  }

  const nodes = Object.values(def.graph?.nodes ?? {});
  if (!nodes.some((n) => NODOS_DE_ENVIO.includes(n.type))) out.push({ codigo: 'sin_acciones' });
  if (nodes.filter((n) => n.type === 'wait').length > LIMITES.esperas) {
    out.push({ codigo: 'demasiadas_esperas', extra: { max: LIMITES.esperas } });
  }

  for (const n of nodes) {
    const c = n.config ?? {};
    if (n.type === 'wait') {
      const ms = msDeEspera(c);
      if (ms === null) out.push({ nodeId: n.id, codigo: 'espera_invalida' });
    }
    if (n.type === 'push') {
      const t = String(c.title ?? '').trim();
      const b = String(c.body ?? '').trim();
      if (!t) out.push({ nodeId: n.id, campo: 'title', codigo: 'push_sin_titulo' });
      if (!b) out.push({ nodeId: n.id, campo: 'body', codigo: 'push_sin_mensaje' });
      if (t.length > LIMITES.tituloPush) out.push({ nodeId: n.id, campo: 'title', codigo: 'texto_largo', extra: { max: LIMITES.tituloPush } });
      if (b.length > LIMITES.cuerpoPush) out.push({ nodeId: n.id, campo: 'body', codigo: 'texto_largo', extra: { max: LIMITES.cuerpoPush } });
      for (const v of variablesDesconocidas(`${t} ${b}`)) out.push({ nodeId: n.id, codigo: 'variable_desconocida', extra: { variable: v } });
    }
    if (n.type === 'sms' || n.type === 'whatsapp') {
      const b = String(c.body ?? '').trim();
      if (!b) out.push({ nodeId: n.id, campo: 'body', codigo: 'mensaje_vacio' });
      if (b.length > LIMITES.cuerpoSms) out.push({ nodeId: n.id, campo: 'body', codigo: 'texto_largo', extra: { max: LIMITES.cuerpoSms } });
      for (const v of variablesDesconocidas(b)) out.push({ nodeId: n.id, codigo: 'variable_desconocida', extra: { variable: v } });
      if (!ctx.smsDisponible) out.push({ nodeId: n.id, codigo: 'canal_no_disponible' });
      if (DISPARADORES_SOLO_PUSH.includes(def.triggerType)) out.push({ nodeId: n.id, codigo: 'alta_solo_push' });
    }
    if (n.type === 'condition') {
      const campo = campoCondicion(c.field);
      if (!campo) out.push({ nodeId: n.id, campo: 'field', codigo: 'condicion_sin_campo' });
      else if (!OPERADORES[campo.tipo].includes(c.op)) out.push({ nodeId: n.id, campo: 'op', codigo: 'condicion_sin_operador' });
      else if (!SIN_VALOR.has(c.op) && !Number.isFinite(Number(c.value))) {
        out.push({ nodeId: n.id, campo: 'value', codigo: 'condicion_sin_valor' });
      } else if (!SIN_VALOR.has(c.op) && (c.value === '' || c.value === null || c.value === undefined)) {
        out.push({ nodeId: n.id, campo: 'value', codigo: 'condicion_sin_valor' });
      }
    }
  }

  // Espera acumulada por camino: un camino de 400 días no termina nunca en la
  // práctica y deja filas vivas para siempre.
  if (def.graph?.rootId) {
    const maxCamino = (id: string | null | undefined, prof = 0): number => {
      if (!id || prof > LIMITES.nodos) return 0;
      const n = def.graph.nodes[id];
      if (!n) return 0;
      const propio = n.type === 'wait' ? msDeEspera(n.config) ?? 0 : 0;
      const hijos = n.type === 'condition' ? [n.yes, n.no] : [n.next];
      return propio + Math.max(0, ...hijos.map((h) => maxCamino(h, prof + 1)));
    };
    if (maxCamino(def.graph.rootId) > LIMITES.esperaMaxMs) out.push({ codigo: 'espera_total_larga' });
  }
  return dedupe(out);
}

export function msDeEspera(c: Record<string, any> | undefined): number | null {
  const amount = Number(c?.amount);
  const unit = c?.unit as UnidadEspera;
  if (!Number.isInteger(amount) || amount < 1 || !MS_UNIDAD[unit]) return null;
  const ms = amount * MS_UNIDAD[unit];
  if (ms < LIMITES.esperaMinMs || ms > LIMITES.esperaMaxMs) return null;
  return ms;
}

function dedupe(ps: Problema[]): Problema[] {
  const seen = new Set<string>();
  return ps.filter((p) => {
    const k = `${p.nodeId ?? ''}|${p.campo ?? ''}|${p.codigo}|${JSON.stringify(p.extra ?? {})}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ───────────────────────── Horario de envío ─────────────────────────

/** Los mensajes de un flujo solo salen entre estas horas, en la zona del negocio. */
export const HORARIO = { desde: 8, hasta: 21 };

/**
 * Si `horaLocalActual` cae fuera del horario, cuántos ms faltan para las 8:00
 * locales; si está dentro, 0. Trabaja con la hora local ya calculada (con
 * minutos como fracción) para no depender de la zona aquí.
 */
export function msHastaHorario(horaLocalActual: number): number {
  const { desde, hasta } = HORARIO;
  if (horaLocalActual >= desde && horaLocalActual < hasta) return 0;
  const horas = horaLocalActual < desde ? desde - horaLocalActual : 24 - horaLocalActual + desde;
  return Math.round(horas * 3_600_000);
}
