/**
 * El formulario con el que un cliente obtiene su tarjeta (`/c/<cardId>`),
 * configurable por negocio (Javier, 2026-10-28): cada negocio decide si el
 * correo y el cumpleaños son obligatorios, opcionales o no se piden, y puede
 * agregar casillas propias («¿Cómo nos conociste?», «Cédula»…).
 *
 * Nombre y teléfono NO son configurables: el teléfono es con lo que se
 * reconoce al cliente cuando vuelve (match por los últimos 10 dígitos en
 * `enrollPublic`) y el nombre va impreso en el pase.
 *
 * Antes esto era una regla fija: Sellea exigía correo y cumpleaños y el resto
 * los dejaba opcionales. Esa regla sigue siendo el valor por defecto de cada
 * marca mientras el negocio no guarde su propio formulario.
 */

export type ModoDeCampo = 'obligatorio' | 'opcional' | 'oculto';
export type TipoDeCampo = 'texto' | 'numero' | 'fecha' | 'opciones';

export interface CampoExtra {
  id: string;
  etiqueta: string;
  tipo: TipoDeCampo;
  obligatorio: boolean;
  /** Solo para `opciones`. */
  opciones?: string[];
}

export interface FormularioDeRegistro {
  email: ModoDeCampo;
  cumpleanos: ModoDeCampo;
  extras: CampoExtra[];
}

/** Lo que se guarda en `Customer.datosDelRegistro`: la etiqueta va con el valor
 *  para que la respuesta se siga entendiendo si después renombran la casilla. */
export type DatosDelRegistro = Record<string, { etiqueta: string; valor: string }>;

export const MAX_EXTRAS = 8;
export const MAX_ETIQUETA = 60;
export const MAX_OPCIONES = 20;
export const MAX_RESPUESTA = 200;

const MODOS: ModoDeCampo[] = ['obligatorio', 'opcional', 'oculto'];
const TIPOS: TipoDeCampo[] = ['texto', 'numero', 'fecha', 'opciones'];

/** Sellea exige correo y cumpleaños (decisión del dueño, 2026-08-30). */
const MARCAS_QUE_EXIGEN_CONTACTO = new Set(['sellea', 'selleala']);

export function formularioPorDefecto(marcaSlug: string | null | undefined): FormularioDeRegistro {
  const exige = MARCAS_QUE_EXIGEN_CONTACTO.has(String(marcaSlug ?? ''));
  return {
    email: exige ? 'obligatorio' : 'opcional',
    cumpleanos: exige ? 'obligatorio' : 'opcional',
    extras: [],
  };
}

const texto = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/**
 * Lo guardado (o lo que manda el editor) llevado a una forma válida. Nunca
 * lanza: lo que no se entiende se descarta. Sin nada guardado → el valor por
 * defecto de la marca.
 */
export function normalizarFormulario(
  raw: unknown,
  marcaSlug: string | null | undefined,
): FormularioDeRegistro {
  const base = formularioPorDefecto(marcaSlug);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const modo = (v: unknown, def: ModoDeCampo) =>
    MODOS.includes(v as ModoDeCampo) ? (v as ModoDeCampo) : def;

  const vistos = new Set<string>();
  const extras: CampoExtra[] = [];
  for (const e of Array.isArray(r.extras) ? r.extras : []) {
    if (extras.length >= MAX_EXTRAS) break;
    if (!e || typeof e !== 'object') continue;
    const x = e as Record<string, unknown>;
    const etiqueta = texto(x.etiqueta, MAX_ETIQUETA);
    if (!etiqueta) continue;
    const tipo = TIPOS.includes(x.tipo as TipoDeCampo) ? (x.tipo as TipoDeCampo) : 'texto';
    let id = texto(x.id, 40).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id || vistos.has(id)) id = `c${extras.length + 1}_${vistos.size}`;
    vistos.add(id);
    const campo: CampoExtra = { id, etiqueta, tipo, obligatorio: x.obligatorio === true };
    if (tipo === 'opciones') {
      const opciones = [
        ...new Set((Array.isArray(x.opciones) ? x.opciones : []).map((o) => texto(o, MAX_ETIQUETA)).filter(Boolean)),
      ].slice(0, MAX_OPCIONES);
      // Una lista sin opciones no se puede contestar: pasa a texto libre.
      if (opciones.length) campo.opciones = opciones;
      else campo.tipo = 'texto';
    }
    extras.push(campo);
  }
  return { email: modo(r.email, base.email), cumpleanos: modo(r.cumpleanos, base.cumpleanos), extras };
}

/**
 * Revisa lo que mandó el cliente contra el formulario del negocio. Devuelve el
 * primer error en español (lo que se le muestra) o las respuestas de las
 * casillas propias listas para guardar.
 */
export function revisarRegistro(
  f: FormularioDeRegistro,
  dto: { email?: string | null; birthday?: string | null; extras?: unknown },
): { error: string } | { datos: DatosDelRegistro } {
  if (f.email === 'obligatorio' && !dto.email?.trim()) {
    return { error: 'El correo electrónico es obligatorio' };
  }
  if (f.cumpleanos === 'obligatorio') {
    const d = dto.birthday ? new Date(dto.birthday) : null;
    if (!d || Number.isNaN(d.getTime())) return { error: 'La fecha de cumpleaños es obligatoria' };
  }
  const recibidas =
    dto.extras && typeof dto.extras === 'object' ? (dto.extras as Record<string, unknown>) : {};
  const datos: DatosDelRegistro = {};
  for (const c of f.extras) {
    const crudo = recibidas[c.id];
    const valor = typeof crudo === 'number' ? String(crudo) : texto(crudo, MAX_RESPUESTA);
    if (!valor) {
      if (c.obligatorio) return { error: `Completa «${c.etiqueta}»` };
      continue;
    }
    if (c.tipo === 'numero' && !/^-?\d+([.,]\d+)?$/.test(valor)) {
      return { error: `«${c.etiqueta}» debe ser un número` };
    }
    if (c.tipo === 'fecha' && Number.isNaN(new Date(valor).getTime())) {
      return { error: `«${c.etiqueta}» no es una fecha válida` };
    }
    if (c.tipo === 'opciones' && !c.opciones?.includes(valor)) {
      return { error: `Elige una opción de «${c.etiqueta}»` };
    }
    datos[c.id] = { etiqueta: c.etiqueta, valor };
  }
  return { datos };
}
