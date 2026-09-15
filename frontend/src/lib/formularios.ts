/**
 * Formularios del equipo, del lado de la pantalla: tipos, etiquetas y la misma
 * lógica de visibilidad y obligatorias que el servidor.
 *
 * Es copia de `backend/src/sales-teams/formularios-de-equipo.ts` (el frontend no
 * puede importar el backend). El servidor vuelve a validar todo; esto solo sirve
 * para que la persona vea qué le falta antes de enviar. Si cambias una regla
 * allí, cámbiala aquí.
 */

export type TipoDeCampo =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'email'
  | 'whatsapp'
  | 'url'
  | 'instagram'
  | 'select'
  | 'radio'
  | 'multiselect'
  | 'checkbox'
  | 'date'
  | 'time';

export const TIPOS_DE_CAMPO: { tipo: TipoDeCampo; label: string; icono: string }[] = [
  { tipo: 'short_text', label: 'Texto corto', icono: '✏️' },
  { tipo: 'long_text', label: 'Texto largo', icono: '📝' },
  { tipo: 'number', label: 'Número', icono: '🔢' },
  { tipo: 'email', label: 'Correo', icono: '✉️' },
  { tipo: 'whatsapp', label: 'WhatsApp', icono: '📱' },
  { tipo: 'url', label: 'Enlace', icono: '🔗' },
  { tipo: 'instagram', label: 'Instagram', icono: '📸' },
  { tipo: 'select', label: 'Lista (una opción)', icono: '▾' },
  { tipo: 'radio', label: 'Botones (una opción)', icono: '⊙' },
  { tipo: 'multiselect', label: 'Varias opciones', icono: '☰' },
  { tipo: 'checkbox', label: 'Casilla (sí/no)', icono: '☑' },
  { tipo: 'date', label: 'Fecha', icono: '📅' },
  { tipo: 'time', label: 'Hora', icono: '🕒' },
];
export const ETIQUETA_DE_TIPO: Record<string, string> = Object.fromEntries(TIPOS_DE_CAMPO.map((t) => [t.tipo, t.label]));
export const TIPOS_CON_OPCIONES: readonly TipoDeCampo[] = ['select', 'radio', 'multiselect'];

export const DESTINOS_EN_EL_LEAD: { clave: string; label: string }[] = [
  { clave: '', label: '— (no pasa al lead)' },
  { clave: 'first_name', label: 'Nombre' },
  { clave: 'last_name', label: 'Apellidos' },
  { clave: 'name', label: 'Nombre completo' },
  { clave: 'whatsapp', label: 'Teléfono / WhatsApp' },
  { clave: 'email', label: 'Correo' },
  { clave: 'company', label: 'Empresa' },
  { clave: 'instagram', label: 'Instagram' },
];

export const OPERADORES: { op: Operador; label: string }[] = [
  { op: 'eq', label: 'es igual a' },
  { op: 'neq', label: 'no es' },
  { op: 'filled', label: 'tiene respuesta' },
];

export type Operador = 'eq' | 'neq' | 'in' | 'filled';
export type CondicionDeCampo = { when: string; op: Operador; value?: string | string[] };
export type OpcionDeCampo = { value: string; label: string; score?: number };

export type CampoDeFormulario = {
  id: string;
  key: string;
  type: TipoDeCampo;
  label: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
  section?: string;
  options?: OpcionDeCampo[];
  score?: number;
  maps_to?: string;
  condition?: CondicionDeCampo | null;
};

export type Respuestas = Record<string, string | string[] | boolean | null>;

export function condicionCumplida(cond: CondicionDeCampo | null | undefined, r: Respuestas): boolean {
  if (!cond || !cond.when) return true;
  const v = r[cond.when];
  const lista = Array.isArray(v) ? v.map(String) : null;
  const texto = v == null ? '' : String(v);
  switch (cond.op) {
    case 'filled':
      return lista ? lista.length > 0 : texto.trim() !== '' && texto !== 'false';
    case 'eq':
      return lista ? lista.includes(String(cond.value ?? '')) : texto === String(cond.value ?? '');
    case 'neq':
      return lista ? !lista.includes(String(cond.value ?? '')) : texto !== String(cond.value ?? '');
    case 'in': {
      const set = Array.isArray(cond.value) ? cond.value : cond.value ? [cond.value] : [];
      return lista ? lista.some((x) => set.includes(x)) : set.includes(texto);
    }
    default:
      return true;
  }
}

/** En cascada: si la pregunta de la que depende otra está oculta, esa otra también. */
export function camposVisibles(campos: CampoDeFormulario[], r: Respuestas): CampoDeFormulario[] {
  const visibles = new Set<string>();
  const out: CampoDeFormulario[] = [];
  for (const c of campos) {
    const cond = c.condition;
    if (cond?.when && (!visibles.has(cond.when) || !condicionCumplida(cond, r))) continue;
    visibles.add(c.key);
    out.push(c);
  }
  return out;
}

const vacia = (v: unknown) =>
  v == null || v === false || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && !v.trim());

export function camposQueFaltan(campos: CampoDeFormulario[], r: Respuestas): string[] {
  return camposVisibles(campos, r)
    .filter((c) => c.required && vacia(r[c.key]))
    .map((c) => c.key);
}

/** Una clave estable a partir del texto de la pregunta, sin repetir las que ya hay. */
export function claveDesdeTexto(texto: string, existentes: Set<string>): string {
  const base =
    (texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'pregunta';
  let clave = base;
  let n = 2;
  while (existentes.has(clave)) clave = `${base}_${n++}`;
  return clave;
}

export function nuevoId(): string {
  return `f_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Igual que en el servidor: para la agenda hace falta una pregunta obligatoria,
 * sin condición y que no sea casilla, que pase al lead el nombre, o un WhatsApp o
 * un correo con ese tipo de pregunta.
 */
export function pideDatoDeContacto(campos: CampoDeFormulario[]): boolean {
  return campos.some(
    (c) =>
      c.required === true &&
      !c.condition?.when &&
      c.type !== 'checkbox' &&
      ['first_name', 'last_name', 'name', 'whatsapp', 'email'].includes(c.maps_to ?? '') &&
      (c.maps_to === 'whatsapp' ? c.type === 'whatsapp' : c.maps_to === 'email' ? c.type === 'email' : true),
  );
}
