// ── Disparadores y filtros de un flujo — lo que comparten los dos constructores ──
//
// El constructor de contactos (EmailMarketingWorkflows) y el de negocios
// (BrandWorkflowsPanel) usan el MISMO editor de disparadores. Todo lo que
// cambia entre uno y otro —qué disparadores hay, sobre qué se puede filtrar,
// qué operadores— sale del catálogo que sirve cada backend; aquí no hay ni una
// lista de disparadores escrita a mano, que es como se desincronizaron antes.

export type OperadorCat = {
  value: string;
  label: string;
  /** Qué control pide el valor. Si el servidor no lo dice (catálogo reducido), se deduce del operador. */
  entrada?: 'ninguna' | 'texto' | 'varios' | 'numero';
  /** Solo tiene sentido sobre estos campos (p. ej. las etiquetas). */
  campos?: string[];
};

export type CampoFiltrable = { key: string; label: string };

export type FiltrosCat = {
  /** Vacío = el disparador no admite filtros (la inscripción manual). */
  campos: CampoFiltrable[];
  operadores: string[];
  nuevo: { field: string; op: string };
};

/** Lo mínimo que el editor necesita saber de un campo de configuración. */
export type CampoBase = { key: string; label: string; tipo: string; requerido?: boolean };

export type DisparadorCat<C extends CampoBase = CampoBase> = {
  key: string;
  label: string;
  grupo: string;
  latencia: 'minutos' | 'hora';
  hint?: string;
  campos?: C[];
  filtros?: FiltrosCat;
};

export type CatalogoDeDisparadores<C extends CampoBase = CampoBase> = {
  disparadores: DisparadorCat<C>[];
  operadores: OperadorCat[];
  /** Campos genéricos: se usan si el disparador no trae los suyos. */
  campos: CampoFiltrable[];
};

/** `value` es una lista en «contiene» y las etiquetas; los flujos de antes guardaban un texto. */
export type Filtro = { field: string; op: string; value?: string | string[] };

export type Disparador = { type: string; filters?: Filtro[]; name?: string; [k: string]: unknown };

/** Quién entra al flujo: cambia los textos, no el comportamiento. */
export type Sujeto = 'contacto' | 'negocio';

/**
 * Los disparadores de un flujo, igual que los lee el motor: manda `triggers`;
 * vacío = flujo de antes, se lee `[trigger]`.
 */
export function disparadoresDelFlujo(wf: { trigger?: unknown; triggers?: unknown }): Disparador[] {
  const lista = Array.isArray(wf?.triggers)
    ? (wf.triggers as unknown[]).filter((t): t is Disparador => !!t && typeof (t as Disparador).type === 'string')
    : [];
  if (lista.length) return lista;
  const uno = wf?.trigger as Disparador | undefined;
  return uno && typeof uno.type === 'string' ? [uno] : [{ type: 'manual' }];
}

const SIN_VALOR = ['filled', 'empty'];
const VARIOS = ['contains', 'not_contains', 'has_tag', 'not_tag'];
const NUMERO = ['gt', 'lt'];

/** Qué control pide el valor de un operador. */
export function entradaDe(op: string, operadores: OperadorCat[]): NonNullable<OperadorCat['entrada']> {
  const delCatalogo = operadores.find((o) => o.value === op)?.entrada;
  if (delCatalogo) return delCatalogo;
  if (SIN_VALOR.includes(op)) return 'ninguna';
  if (VARIOS.includes(op)) return 'varios';
  if (NUMERO.includes(op)) return 'numero';
  return 'texto';
}

/** Los valores de un filtro como lista: acepta la lista de ahora y el texto de antes. */
export function valoresComoLista(value: unknown): string[] {
  const crudos = Array.isArray(value) ? value : String(value ?? '').split('\n');
  return crudos.map((v) => String(v ?? '').trim()).filter(Boolean);
}

/**
 * El valor adaptado al control del operador nuevo. Pasar de «contiene» a «es»
 * se queda con el primer valor en vez de perderlos todos sin avisar.
 */
export function valorPara(entrada: NonNullable<OperadorCat['entrada']>, value: unknown): string | string[] | undefined {
  if (entrada === 'ninguna') return undefined;
  const lista = valoresComoLista(value);
  if (entrada === 'varios') return lista;
  return lista[0] ?? '';
}

/**
 * ¿Le falta el valor a este filtro? Un «tiene etiqueta» sin etiqueta no deja
 * entrar a nadie, y un «contiene» sin nada deja entrar a todos: los dos son
 * un flujo que no hace lo que se configuró.
 */
export function filtroIncompleto(f: Filtro, operadores: OperadorCat[]): boolean {
  const entrada = entradaDe(f.op, operadores);
  if (entrada === 'ninguna') return false;
  return valoresComoLista(f.value).length === 0;
}

export function disparadorIncompleto<C extends CampoBase>(
  d: Disparador,
  def: DisparadorCat<C> | null | undefined,
  operadores: OperadorCat[],
): boolean {
  const faltaCampo = (def?.campos ?? []).some((c) => c.requerido && String(d[c.key] ?? '').trim() === '');
  return faltaCampo || (d.filters ?? []).some((f) => filtroIncompleto(f, operadores));
}

/** Cuándo entra de verdad: hay disparadores que se revisan cada hora. */
export function notaDeLatencia(def: { key: string; latencia: string } | null | undefined): string {
  if (!def || def.key === 'manual') return 'Los inscribes tú desde «Inscribir»';
  return def.latencia === 'minutos' ? 'Automático · entra en minutos' : 'Automático · se revisa cada hora';
}

/** Los campos sobre los que puede filtrar un disparador (los suyos o, si el catálogo no los trae, los genéricos). */
export function camposDeFiltro<C extends CampoBase>(def: DisparadorCat<C> | null | undefined, cat: CatalogoDeDisparadores<C>): CampoFiltrable[] {
  return def?.filtros ? def.filtros.campos : cat.campos;
}

/** Los operadores que ofrece un disparador para un campo concreto. */
export function operadoresPara(campo: string, permitidos: string[] | null, cat: OperadorCat[]): OperadorCat[] {
  return cat.filter((o) => (!permitidos || permitidos.includes(o.value)) && (!o.campos || o.campos.includes(campo)));
}

/** El filtro con el que nace uno nuevo en este disparador. */
export function filtroNuevo<C extends CampoBase>(def: DisparadorCat<C> | null | undefined, cat: CatalogoDeDisparadores<C>): Filtro {
  const campos = camposDeFiltro(def, cat);
  const pedido = def?.filtros?.nuevo;
  const field = pedido && campos.some((c) => c.key === pedido.field) ? pedido.field : campos[0]?.key ?? '';
  const ops = operadoresPara(field, def?.filtros?.operadores ?? null, cat.operadores);
  const op = pedido && ops.some((o) => o.value === pedido.op) ? pedido.op : ops[0]?.value ?? 'eq';
  return { field, op, value: valorPara(entradaDe(op, cat.operadores), '') };
}

/**
 * El disparador con otro tipo. Se quitan los filtros sobre campos que el tipo
 * nuevo no trae: «Contenido de la respuesta» en un «Contacto nuevo» está
 * siempre vacío, y el filtro dejaría el flujo sin arrancar nunca.
 */
export function cambiarTipo<C extends CampoBase>(d: Disparador, tipo: string, cat: CatalogoDeDisparadores<C>): Disparador {
  const def = cat.disparadores.find((x) => x.key === tipo);
  const validos = def?.filtros ? new Set(def.filtros.campos.map((c) => c.key)) : null;
  const filters = (d.filters ?? []).filter((f) => !validos || validos.has(f.field));
  const siguiente: Disparador = { ...d, type: tipo };
  if (filters.length) siguiente.filters = filters;
  else delete siguiente.filters;
  return siguiente;
}

/**
 * Con qué nace un disparador añadido: el primer automático del catálogo. Una
 * segunda «Inscripción manual» no añade nada —ya se puede inscribir a mano
 * siempre— y obligaría a cambiarla antes de que sirva.
 */
export function disparadorNuevo<C extends CampoBase>(cat: CatalogoDeDisparadores<C>): Disparador {
  return { type: cat.disparadores.find((d) => d.key !== 'manual')?.key ?? 'manual' };
}

/** Agrupa conservando el orden en que el backend mandó los grupos. */
export function porGrupo<T extends { grupo: string }>(items: T[]): { grupo: string; items: T[] }[] {
  const out: { grupo: string; items: T[] }[] = [];
  for (const it of items) {
    const found = out.find((g) => g.grupo === it.grupo);
    if (found) found.items.push(it);
    else out.push({ grupo: it.grupo, items: [it] });
  }
  return out;
}

/** Una línea bajo el nombre del disparador en el lienzo. */
export function resumenDeDisparador<C extends CampoBase>(d: Disparador, def: DisparadorCat<C> | null | undefined): string {
  const partes: string[] = [];
  const etiqueta = String(d.tag ?? '').trim();
  if (etiqueta) partes.push(`«${etiqueta}»`);
  const n = d.filters?.length ?? 0;
  if (n) partes.push(`${n} filtro${n === 1 ? '' : 's'}`);
  // Un tipo que el catálogo no trae (catálogo reducido) no sabemos cuándo
  // entra: mejor no decir nada que decir «los inscribes tú» de uno automático.
  if (def || d.type === 'manual') partes.push(notaDeLatencia(def ?? { key: 'manual', latencia: 'minutos' }));
  return partes.join(' · ');
}
