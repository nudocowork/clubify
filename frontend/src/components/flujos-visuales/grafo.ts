/**
 * Operaciones sobre el grafo de un flujo, puras y sin React.
 *
 * El grafo es un ÁRBOL: cada paso tiene un solo padre y el backend rechaza
 * ciclos (`problemasDeForma` en backend/src/automations/flujo/grafo.ts). Estas
 * operaciones lo mantienen así: insertar, borrar, duplicar y mover solo
 * re-enlazan punteros, nunca crean un segundo camino hacia un paso.
 */

export type TipoNodo = 'wait' | 'push' | 'sms' | 'whatsapp' | 'condition' | 'end';

export type Nodo = {
  id: string;
  type: TipoNodo;
  config: Record<string, any>;
  next?: string | null;
  yes?: string | null;
  no?: string | null;
};

export type Grafo = { rootId: string | null; nodes: Record<string, Nodo> };

/** Dónde se engancha algo: la raíz, o la salida `next`/`yes`/`no` de un paso. */
export type Hueco = { padre: string | null; rama: 'next' | 'yes' | 'no' };

export type Flujo = {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused';
  triggerType: string;
  triggerDays: number | null;
  triggerConfig: { cardId?: string };
  reentry: 'once' | 'after_finish';
  templateKey?: string | null;
  schemaVersion: number;
  graph: Grafo;
};

export type Problema = { nodeId?: string; campo?: string; codigo: string; extra?: Record<string, any> };

export const nuevoId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}${Math.random()}`
  )
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 10);

export function nodoVacio(type: TipoNodo): Nodo {
  const id = nuevoId();
  switch (type) {
    case 'wait':
      return { id, type, config: { amount: 1, unit: 'days' }, next: null };
    case 'push':
      return { id, type, config: { title: '', body: '' }, next: null };
    case 'sms':
    case 'whatsapp':
      return { id, type, config: { body: '' }, next: null };
    case 'condition':
      return { id, type, config: { field: '', op: '' }, yes: null, no: null };
    case 'end':
      return { id, type, config: {} };
  }
}

const clonar = (g: Grafo): Grafo => ({ rootId: g.rootId, nodes: { ...g.nodes } });

function leer(g: Grafo, h: Hueco): string | null {
  if (!h.padre) return g.rootId;
  return (g.nodes[h.padre]?.[h.rama] as string | null | undefined) ?? null;
}

function escribir(g: Grafo, h: Hueco, valor: string | null) {
  if (!h.padre) {
    g.rootId = valor;
    return;
  }
  g.nodes[h.padre] = { ...g.nodes[h.padre], [h.rama]: valor };
}

/** El hueco del que cuelga un paso (quién apunta a él). */
export function huecoDe(g: Grafo, id: string): Hueco | null {
  if (g.rootId === id) return { padre: null, rama: 'next' };
  for (const n of Object.values(g.nodes)) {
    if (n.type === 'condition') {
      if (n.yes === id) return { padre: n.id, rama: 'yes' };
      if (n.no === id) return { padre: n.id, rama: 'no' };
    } else if (n.next === id) return { padre: n.id, rama: 'next' };
  }
  return null;
}

/**
 * Inserta un paso en un hueco. Lo que colgaba de ahí pasa a colgar del nuevo;
 * si el nuevo es una condición, lo de abajo sigue por la rama «Sí».
 * Un «Fin» insertado corta: lo que había debajo se elimina.
 */
export function insertar(g: Grafo, h: Hueco, nodo: Nodo): Grafo {
  const out = clonar(g);
  const abajo = leer(out, h);
  if (nodo.type === 'end') {
    if (abajo) borrarSubarbol(out, abajo);
    out.nodes[nodo.id] = nodo;
  } else if (nodo.type === 'condition') {
    out.nodes[nodo.id] = { ...nodo, yes: abajo, no: null };
  } else {
    out.nodes[nodo.id] = { ...nodo, next: abajo };
  }
  escribir(out, h, nodo.id);
  return out;
}

function borrarSubarbol(g: Grafo, id: string | null | undefined) {
  if (!id || !g.nodes[id]) return;
  const n = g.nodes[id];
  delete g.nodes[id];
  if (n.type === 'condition') {
    borrarSubarbol(g, n.yes);
    borrarSubarbol(g, n.no);
  } else borrarSubarbol(g, n.next);
}

/** Pasos que se pierden al borrar una condición (su rama «No»). */
export function pasosDeRama(g: Grafo, id: string | null | undefined): number {
  if (!id || !g.nodes[id]) return 0;
  const n = g.nodes[id];
  return 1 + (n.type === 'condition' ? pasosDeRama(g, n.yes) + pasosDeRama(g, n.no) : pasosDeRama(g, n.next));
}

/**
 * Borra un paso. Lo de debajo sube a su lugar. Borrar una condición conserva
 * su rama «Sí» y elimina la «No» (la interfaz lo avisa antes).
 */
export function borrar(g: Grafo, id: string): Grafo {
  const out = clonar(g);
  const n = out.nodes[id];
  const h = huecoDe(out, id);
  if (!n || !h) return g;
  let sube: string | null = null;
  if (n.type === 'condition') {
    sube = n.yes ?? null;
    borrarSubarbol(out, n.no);
  } else if (n.type !== 'end') sube = n.next ?? null;
  delete out.nodes[id];
  escribir(out, h, sube);
  return out;
}

/** Copia un paso (no una condición: duplicaría ramas enteras) justo debajo de sí mismo. */
export function duplicar(g: Grafo, id: string): Grafo {
  const n = g.nodes[id];
  if (!n || n.type === 'condition' || n.type === 'end') return g;
  const copia: Nodo = { ...n, id: nuevoId(), config: { ...n.config } };
  return insertar(g, { padre: id, rama: 'next' }, copia);
}

/** ¿Se puede subir/bajar? Solo entre pasos simples seguidos. */
export function puedeMover(g: Grafo, id: string, dir: -1 | 1): boolean {
  const n = g.nodes[id];
  if (!n || n.type === 'condition' || n.type === 'end') return false;
  if (dir === -1) {
    const h = huecoDe(g, id);
    const p = h?.padre ? g.nodes[h.padre] : null;
    return !!p && h!.rama === 'next' && p.type !== 'condition';
  }
  const sig = n.next ? g.nodes[n.next] : null;
  return !!sig && sig.type !== 'condition' && sig.type !== 'end';
}

/** Intercambia un paso con el de arriba (-1) o el de abajo (+1), re-enlazando. */
export function mover(g: Grafo, id: string, dir: -1 | 1): Grafo {
  if (!puedeMover(g, id, dir)) return g;
  const out = clonar(g);
  const [arriba, abajo] =
    dir === -1 ? [huecoDe(out, id)!.padre!, id] : [id, out.nodes[id].next!];
  const hArriba = huecoDe(out, arriba)!;
  const A = out.nodes[arriba];
  const B = out.nodes[abajo];
  escribir(out, hArriba, B.id);
  out.nodes[B.id] = { ...B, next: A.id };
  out.nodes[A.id] = { ...A, next: B.next ?? null };
  return out;
}

export function actualizar(g: Grafo, id: string, config: Record<string, any>): Grafo {
  const out = clonar(g);
  out.nodes[id] = { ...out.nodes[id], config: { ...out.nodes[id].config, ...config } };
  return out;
}

/**
 * Lo que se ve incompleto ya mientras se edita, sin ir al servidor: el aviso
 * «sin configurar» de cada paso. El servidor manda al activar.
 */
export function incompleto(n: Nodo): boolean {
  const c = n.config ?? {};
  switch (n.type) {
    case 'wait':
      return !(Number(c.amount) >= 1) || !c.unit;
    case 'push':
      return !String(c.title ?? '').trim() || !String(c.body ?? '').trim();
    case 'sms':
    case 'whatsapp':
      return !String(c.body ?? '').trim();
    case 'condition':
      return !c.field || !c.op || (!['empty', 'not_empty', 'is_true', 'is_false'].includes(c.op) && (c.value === undefined || c.value === ''));
    default:
      return false;
  }
}
