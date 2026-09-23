// ── FILTROS Y VARIOS DISPARADORES — lo que comparten los dos motores ──
//
// Vive aquí y el motor de contactos lo importa, igual que `destinoInterno`: dos
// copias de la misma regla se separan a la primera corrección, y esta regla
// decide a quién le llega un mensaje. Es un archivo de helpers puros, sin Nest:
// importarlo no crea ninguna dependencia entre módulos.

/** Los 12 operadores de TeamClubify. */
export type WFOperador =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'gt'
  | 'lt'
  | 'filled'
  | 'empty'
  | 'has_tag'
  | 'not_tag';

/**
 * Una condición: la de un filtro del disparador o la de un paso «Si / No».
 *
 * `op` es `string` y no `WFOperador` a propósito: viene de la base, y un flujo
 * importado o de otra versión puede traer cualquier cosa. El motor tiene que
 * saber qué hacer con lo que no reconoce (ver `cumpleCondicion`).
 *
 * `value` es una lista en «contiene», «no contiene» y las etiquetas; los
 * flujos de antes lo guardaban como un texto suelto, y se sigue aceptando.
 */
export type WFCondition = { field: string; op: string; value?: string | string[] };

export type WFTrigger = { type: string; filters?: WFCondition[]; name?: string; [k: string]: unknown };

export type OperadorDeFiltro = {
  value: WFOperador;
  label: string;
  /** Qué control dibuja la pantalla para el valor. */
  entrada: 'ninguna' | 'texto' | 'varios' | 'numero';
  /** Solo tiene sentido sobre estos campos. Sin esto, vale para cualquiera. */
  campos?: string[];
};

export const OPERADORES: OperadorDeFiltro[] = [
  { value: 'eq', label: 'es', entrada: 'texto' },
  { value: 'neq', label: 'no es', entrada: 'texto' },
  { value: 'contains', label: 'contiene', entrada: 'varios' },
  { value: 'not_contains', label: 'no contiene', entrada: 'varios' },
  { value: 'starts_with', label: 'empieza con', entrada: 'texto' },
  { value: 'ends_with', label: 'termina con', entrada: 'texto' },
  { value: 'gt', label: 'mayor que', entrada: 'numero' },
  { value: 'lt', label: 'menor que', entrada: 'numero' },
  { value: 'filled', label: 'tiene valor', entrada: 'ninguna' },
  { value: 'empty', label: 'está vacío', entrada: 'ninguna' },
  // Solo sobre «Etiquetas»: «el nombre tiene la etiqueta X» no significa nada,
  // y ofrecerlo con cualquier campo invita a configurar un filtro que no hace
  // lo que parece.
  { value: 'has_tag', label: 'tiene etiqueta', entrada: 'varios', campos: ['tags'] },
  { value: 'not_tag', label: 'no tiene etiqueta', entrada: 'varios', campos: ['tags'] },
];

const OPERADORES_DE_ETIQUETA: WFOperador[] = ['has_tag', 'not_tag'];

/**
 * Los operadores que ofrece un motor. Los de etiqueta solo donde el sujeto
 * TIENE etiquetas: los negocios no, y ofrecerlos allí sería un filtro que no
 * casa nunca.
 */
export function operadoresDe(conEtiquetas: boolean): OperadorDeFiltro[] {
  return conEtiquetas ? OPERADORES : OPERADORES.filter((o) => !OPERADORES_DE_ETIQUETA.includes(o.value));
}

/** Minúsculas y sin tildes: quien contesta «Sí» escribe «si», «SI» o «sí». */
export function sinAcentos(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Los valores de una condición, en minúsculas y sin vacíos.
 *
 * Acepta la lista de ahora y el texto de antes. El texto se parte SOLO por
 * saltos de línea, nunca por comas —igual que TeamClubify—: una frase clave
 * puede llevar coma («Hola, me interesa») y partirla haría que «hola» casara
 * con todo.
 */
export function valoresDe(value: unknown): string[] {
  const crudos = Array.isArray(value) ? value : String(value ?? '').split('\n');
  return crudos.map((v) => String(v ?? '').toLowerCase().trim()).filter(Boolean);
}

/** El valor único de los operadores que comparan con uno solo. */
function unValor(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '').toLowerCase().trim() : String(value ?? '').toLowerCase().trim();
}

function numero(texto: string): number {
  return parseFloat(texto.replace(',', '.'));
}

/**
 * ¿Cumple el contexto esta condición?
 *
 * Un operador que no se reconoce devuelve `false`. Hasta el 2026-09-22 devolvía
 * `true`, y un filtro con un operador mal escrito —o de una versión más nueva—
 * dejaba entrar a TODO el mundo: el flujo pensado para «los que dijeron sí» le
 * escribía a cualquiera que contestara. Falla cerrado: si no sabemos leer el
 * filtro, no se manda nada.
 */
export function cumpleCondicion(c: WFCondition, ctx: Record<string, string>): boolean {
  const v = String(ctx[c?.field] ?? '').toLowerCase().trim();
  switch (c?.op) {
    case 'eq':
      return v === unValor(c.value);
    case 'neq':
      return v !== unValor(c.value);
    case 'contains': {
      // Casa si aparece CUALQUIERA. Sin valores sigue casando, como antes:
      // `includes('')` era `true`, y un «Si / No» ya publicado que tuviera la
      // condición a medio rellenar no puede cambiar de rama por esto.
      const lista = valoresDe(c.value);
      return lista.length ? lista.some((t) => v.includes(t)) : true;
    }
    case 'not_contains':
      return !valoresDe(c.value).some((t) => v.includes(t));
    case 'starts_with':
      return v.startsWith(unValor(c.value));
    case 'ends_with':
      return v.endsWith(unValor(c.value));
    case 'gt':
    case 'lt': {
      // Comparación NUMÉRICA. Un campo o un valor que no es número da `false`:
      // «pedidos mayor que abc» no puede dejar entrar a nadie.
      const a = numero(v);
      const b = numero(unValor(c.value));
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return c.op === 'gt' ? a > b : a < b;
    }
    case 'filled':
      return v !== '';
    case 'empty':
      return v === '';
    case 'has_tag':
    case 'not_tag': {
      // Las etiquetas se comparan sin tildes ni mayúsculas, igual que en
      // «Agregar etiqueta» y en el disparador: «VIP» y «vip» son la misma.
      const tiene = new Set(
        String(ctx.tags ?? '')
          .split(',')
          .map((t) => sinAcentos(t).trim())
          .filter(Boolean),
      );
      const pedidas = valoresDe(c.value).map(sinAcentos);
      // «Tiene etiqueta» sin decir cuál no deja entrar a nadie: es un filtro a
      // medias, y la pantalla lo marca como «Vacío».
      if (c.op === 'has_tag') return pedidas.some((t) => tiene.has(t));
      return !pedidas.some((t) => tiene.has(t));
    }
    default:
      return false;
  }
}

/** Evalúa condiciones contra el contexto (all = Y, any = O). */
export function evalWF(
  conditions: WFCondition[] | undefined,
  ctx: Record<string, string>,
  match: 'all' | 'any' = 'all',
): boolean {
  if (!conditions || !conditions.length) return true;
  const test = (c: WFCondition) => cumpleCondicion(c, ctx);
  return match === 'all' ? conditions.every(test) : conditions.some(test);
}

// ── Varios disparadores por flujo ──────────────────────────────────────────

function esDisparador(t: unknown): t is WFTrigger {
  return !!t && typeof t === 'object' && !Array.isArray(t) && typeof (t as WFTrigger).type === 'string';
}

/**
 * Los disparadores de un flujo. Manda `triggers`; si viene vacío es un flujo
 * de antes de que existiera la lista, y se lee `[trigger]` —igual que
 * TeamClubify—. Así un flujo publicado sigue arrancando igual sin migrar datos.
 */
export function disparadoresDe(wf: { trigger?: unknown; triggers?: unknown }): WFTrigger[] {
  if (Array.isArray(wf?.triggers) && wf.triggers.length) return wf.triggers.filter(esDisparador);
  return esDisparador(wf?.trigger) ? [wf.trigger] : [];
}

/** ¿Tiene el flujo algún disparador de este tipo? */
export function escuchaEl(wf: { trigger?: unknown; triggers?: unknown }, tipo: string): boolean {
  return disparadoresDe(wf).some((t) => t.type === tipo);
}

/**
 * El nombre legible del disparador por el que entró alguien. Va al contexto
 * de la inscripción: quien mire el registro, o un paso posterior, tiene que
 * poder saber por cuál de los disparadores entró.
 */
export function etiquetaDeDisparador(t: WFTrigger, indice: number, catalogo: { key: string; label: string }[]): string {
  const nombre = String(t.name ?? '').trim();
  if (nombre) return nombre;
  const base = catalogo.find((d) => d.key === t.type)?.label ?? t.type;
  // El ajuste que distingue a este disparador de otro del mismo tipo: la
  // etiqueta, el estado de la cita, la etapa o el embudo. Sin esto, dos
  // «Estado de la cita cambió» —uno para cancelada y otro para confirmada— se
  // llaman igual en el registro, y no hay forma de saber por cuál entró nadie.
  const detalle = String(t.tag ?? t.estado ?? t.etapa ?? t.embudo ?? '').trim();
  return detalle ? `${base} · ${detalle}` : `${base} #${indice + 1}`;
}

/**
 * El primer disparador del flujo que casa con lo que acaba de pasar.
 *
 * Entre disparadores basta con UNO (lógica O); dentro de cada uno, sus filtros
 * se exigen TODOS (lógica Y). Gana el primero de la lista que case, como en
 * TeamClubify: así el contexto dice un solo disparador aunque casen varios.
 *
 * `cumple` es lo propio de cada tipo que no es un filtro: la etiqueta pedida,
 * los días antes del vencimiento… Se evalúa antes que los filtros porque suele
 * ser gratis y los filtros pueden pedir el contexto.
 */
export function disparadorQueCasa(
  lista: WFTrigger[],
  tipo: string,
  ctx: Record<string, string>,
  cumple?: (t: WFTrigger) => boolean,
): { disparador: WFTrigger; indice: number } | null {
  for (let i = 0; i < lista.length; i++) {
    const t = lista[i];
    if (!t || t.type !== tipo) continue;
    if (cumple && !cumple(t)) continue;
    if (!evalWF(t.filters, ctx, 'all')) continue;
    return { disparador: t, indice: i };
  }
  return null;
}

// ── Validación de lo que manda la pantalla ─────────────────────────────────

/**
 * Lo que se escribe en la base a partir de lo que mandó el constructor.
 *
 * `trigger` se sigue escribiendo —con el PRIMERO de la lista— para que todo lo
 * que todavía lo lee (y la base de antes de la migración) vea el de siempre.
 *
 * Una pantalla vieja, abierta desde antes del despliegue, solo manda `trigger`:
 * se guarda como una lista de uno. Es lo que esa persona ve y lo que acaba de
 * guardar; dejar la lista vieja haría que su cambio no sirviera para nada,
 * porque el motor lee la lista primero.
 *
 * `data: null` = el cuerpo no traía disparadores (p. ej. solo publicar).
 */
export function disparadoresParaGuardar(
  body: { trigger?: unknown; triggers?: unknown },
  operadoresValidos: string[],
): { ok: true; data: { trigger: WFTrigger; triggers: WFTrigger[] } | null } | { ok: false; error: string } {
  const crudo = body.triggers != null ? body.triggers : body.trigger != null ? [body.trigger] : null;
  if (crudo === null) return { ok: true, data: null };
  const r = normalizarDisparadores(crudo, operadoresValidos);
  if (!r.ok) return r;
  return { ok: true, data: { trigger: r.lista[0], triggers: r.lista } };
}

const MAX_DISPARADORES = 20;
const MAX_FILTROS = 20;
const MAX_VALORES = 50;

export type ResultadoDisparadores = { ok: true; lista: WFTrigger[] } | { ok: false; error: string };

/**
 * Valida y limpia la lista de disparadores que llega del constructor.
 *
 * No rechaza un TIPO desconocido: un flujo viejo puede tener uno que el
 * catálogo ya no trae, y rechazarlo impediría guardar ese flujo por cualquier
 * otro cambio. Sí rechaza un OPERADOR desconocido: el motor lo trataría como
 * «no cumple» y el flujo no arrancaría nunca, y eso hay que saberlo al guardar,
 * no descubrirlo cuando no llega nada.
 *
 * De cada disparador se guardan `type`, `name`, `filters` y los ajustes planos
 * de su tipo (etiqueta, días antes…). Un objeto anidado no es un ajuste de
 * ningún disparador y no se guarda.
 */
export function normalizarDisparadores(raw: unknown, operadoresValidos: string[]): ResultadoDisparadores {
  if (!Array.isArray(raw)) return { ok: false, error: 'Los disparadores tienen que ser una lista.' };
  if (!raw.length) return { ok: false, error: 'El flujo necesita al menos un disparador.' };
  if (raw.length > MAX_DISPARADORES) return { ok: false, error: `Como mucho ${MAX_DISPARADORES} disparadores por flujo.` };
  const lista: WFTrigger[] = [];
  for (const [i, t] of raw.entries()) {
    const n = i + 1;
    if (!t || typeof t !== 'object' || Array.isArray(t)) return { ok: false, error: `El disparador ${n} no es válido.` };
    const tipo = String((t as Record<string, unknown>).type ?? '').trim();
    if (!tipo || tipo.length > 60) return { ok: false, error: `Al disparador ${n} le falta el tipo.` };
    const limpio: WFTrigger = { type: tipo };
    for (const [clave, valor] of Object.entries(t as Record<string, unknown>)) {
      if (clave === 'type' || clave === 'filters') continue;
      if (clave === 'name') {
        const nombre = String(valor ?? '').trim().slice(0, 80);
        if (nombre) limpio.name = nombre;
        continue;
      }
      if (valor === null || ['string', 'number', 'boolean'].includes(typeof valor)) {
        limpio[clave] = typeof valor === 'string' ? valor.slice(0, 200) : valor;
      }
    }
    const filtros = (t as Record<string, unknown>).filters;
    if (filtros !== undefined && filtros !== null) {
      if (!Array.isArray(filtros)) return { ok: false, error: `Los filtros del disparador ${n} tienen que ser una lista.` };
      if (filtros.length > MAX_FILTROS) return { ok: false, error: `Como mucho ${MAX_FILTROS} filtros por disparador.` };
      const limpios: WFCondition[] = [];
      for (const f of filtros) {
        const campo = String((f as WFCondition)?.field ?? '').trim();
        const op = String((f as WFCondition)?.op ?? '').trim();
        if (!campo || campo.length > 60) return { ok: false, error: `Un filtro del disparador ${n} no dice sobre qué campo.` };
        if (!operadoresValidos.includes(op)) {
          return { ok: false, error: `El filtro «${campo}» del disparador ${n} usa un operador desconocido («${op || 'vacío'}»).` };
        }
        const bruto = (f as WFCondition).value;
        let value: string | string[] | undefined;
        if (Array.isArray(bruto)) {
          const valores = bruto.map((v) => String(v ?? '').trim().slice(0, 200)).filter(Boolean);
          if (valores.length > MAX_VALORES) return { ok: false, error: `Como mucho ${MAX_VALORES} valores por filtro.` };
          value = valores;
        } else if (bruto !== undefined && bruto !== null) {
          value = String(bruto).slice(0, 500);
        }
        limpios.push(value === undefined ? { field: campo, op } : { field: campo, op, value });
      }
      limpio.filters = limpios;
    }
    lista.push(limpio);
  }
  return { ok: true, lista };
}
