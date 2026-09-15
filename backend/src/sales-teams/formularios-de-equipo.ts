import type { Prisma } from '@prisma/client';

/**
 * Las reglas de «Formularios» del equipo: qué preguntas admite un formulario,
 * cómo se limpia lo que guarda el constructor, qué preguntas se ven según las
 * respuestas, qué falta por contestar, qué pasa al lead y cuánto puntúa.
 *
 * Puras a propósito —sin Nest ni base— para probarlas contra este módulo. Es
 * `lib/forms.ts` de TeamClubify adaptado a los datos del lead de Clubify PRO. Las
 * claves del JSON (`type`, `key`, `maps_to`, `condition`…) se quedan como en la
 * referencia: un formulario copiado de allí se lee igual aquí.
 *
 * Fuera por ahora: los tipos «archivo» e «imagen», que necesitan dónde guardar
 * lo que se sube.
 */

export const TIPOS_DE_CAMPO = [
  'short_text',
  'long_text',
  'number',
  'email',
  'whatsapp',
  'url',
  'instagram',
  'select',
  'radio',
  'multiselect',
  'checkbox',
  'date',
  'time',
] as const;
export type TipoDeCampo = (typeof TIPOS_DE_CAMPO)[number];

export const TIPOS_CON_OPCIONES: readonly TipoDeCampo[] = ['select', 'radio', 'multiselect'];

/**
 * A qué dato del lead va una respuesta. Lo que no tiene columna en el lead
 * (facturación, «¿invertir?», servicio) no se pierde: queda en la respuesta.
 */
export const DESTINOS_EN_EL_LEAD = ['first_name', 'last_name', 'name', 'whatsapp', 'email', 'company', 'instagram'] as const;
export type DestinoEnElLead = (typeof DESTINOS_EN_EL_LEAD)[number];

export const OPERADORES = ['eq', 'neq', 'in', 'filled'] as const;
export type Operador = (typeof OPERADORES)[number];

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
  maps_to?: DestinoEnElLead;
  condition?: CondicionDeCampo | null;
};

export type Respuestas = Record<string, string | string[] | boolean | null>;

export const MAX_CAMPOS = 60;
export const MAX_OPCIONES = 50;
const CLAVE = /^[a-z0-9_]{1,40}$/;

const recortar = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Puntaje de 0 a 100; lo que no es un número es 0. */
function puntaje(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

/**
 * Lo que guarda el constructor, limpio y validado.
 *
 * El JSON llega de la pantalla y se guarda en la base: se aceptan solo las
 * claves conocidas, con tamaños acotados. Una condición solo puede depender de
 * una pregunta ANTERIOR: de sí misma o de una posterior dejaría preguntas que
 * nunca aparecen.
 */
export function normalizarCampos(raw: unknown): CampoDeFormulario[] | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Las preguntas del formulario no son una lista' };
  if (raw.length > MAX_CAMPOS) return { error: `Un formulario admite como mucho ${MAX_CAMPOS} preguntas` };

  const anteriores = new Set<string>();
  const out: CampoDeFormulario[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as Record<string, unknown> | null;
    if (!c || typeof c !== 'object') return { error: `La pregunta ${i + 1} no es válida` };
    const type = c.type as TipoDeCampo;
    if (!(TIPOS_DE_CAMPO as readonly string[]).includes(type)) {
      return { error: `La pregunta ${i + 1} tiene un tipo que no existe` };
    }
    const label = recortar(c.label, 200);
    if (!label) return { error: `La pregunta ${i + 1} no tiene texto` };
    const key = recortar(c.key, 40);
    if (!CLAVE.test(key)) return { error: `La clave de «${label}» solo admite minúsculas, números y _` };
    // `__proto__`, `constructor`, `toString`…: con `__proto__` la respuesta se
    // perdía (el setter del prototipo se la traga) y el lead salía como
    // «[object Object]» (Fable, 2026-09-15).
    if (key in Object.prototype) return { error: `«${key}» es una clave reservada: elige otra` };
    if (anteriores.has(key)) return { error: `Dos preguntas usan la misma clave «${key}»` };

    const campo: CampoDeFormulario = { id: recortar(c.id, 40) || `f_${key}`, key, type, label };
    const help = recortar(c.help, 300);
    if (help) campo.help = help;
    const placeholder = recortar(c.placeholder, 120);
    if (placeholder) campo.placeholder = placeholder;
    const section = recortar(c.section, 80);
    if (section) campo.section = section;
    if (c.required === true) campo.required = true;
    const score = puntaje(c.score);
    if (score) campo.score = score;

    if (TIPOS_CON_OPCIONES.includes(type)) {
      if (!Array.isArray(c.options) || !c.options.length) return { error: `«${label}» necesita al menos una opción` };
      if (c.options.length > MAX_OPCIONES) return { error: `«${label}» tiene más de ${MAX_OPCIONES} opciones` };
      const valores = new Set<string>();
      const opciones: OpcionDeCampo[] = [];
      for (const o of c.options as Array<Record<string, unknown> | null>) {
        const value = recortar(o?.value, 80);
        if (!value) return { error: `Una opción de «${label}» está vacía` };
        if (valores.has(value)) return { error: `«${label}» repite la opción «${value}»` };
        valores.add(value);
        const opcion: OpcionDeCampo = { value, label: recortar(o?.label, 120) || value };
        const s = puntaje(o?.score);
        if (s) opcion.score = s;
        opciones.push(opcion);
      }
      campo.options = opciones;
    }

    const destino = recortar(c.maps_to, 20);
    if (destino) {
      if (!(DESTINOS_EN_EL_LEAD as readonly string[]).includes(destino)) {
        return { error: `«${label}» apunta a un dato del lead que no existe` };
      }
      campo.maps_to = destino as DestinoEnElLead;
    }

    if (c.condition && typeof c.condition === 'object') {
      const k = c.condition as Record<string, unknown>;
      const when = recortar(k.when, 40);
      if (when) {
        if (!anteriores.has(when)) return { error: `«${label}» depende de una pregunta que no está antes que ella` };
        const op = k.op as Operador;
        if (!(OPERADORES as readonly string[]).includes(op)) return { error: `La condición de «${label}» no es válida` };
        const cond: CondicionDeCampo = { when, op };
        if (op !== 'filled') {
          cond.value = Array.isArray(k.value)
            ? k.value.map((x) => recortar(x, 80)).filter(Boolean).slice(0, 20)
            : recortar(k.value, 80);
        }
        campo.condition = cond;
      }
    }

    anteriores.add(key);
    out.push(campo);
  }
  return out;
}

/** ¿Se cumple la condición con estas respuestas? Sin condición, siempre. */
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

/**
 * Las preguntas que se ven con estas respuestas.
 *
 * En cascada, y en eso mejora a la referencia: si la pregunta de la que depende
 * otra está oculta, esa otra también. Sin esto, una respuesta vieja de una
 * pregunta que ya no se ve seguía mostrando —y exigiendo— sus dependientes.
 */
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

/** Las claves de las preguntas visibles y obligatorias que siguen sin respuesta. */
export function camposQueFaltan(campos: CampoDeFormulario[], r: Respuestas): string[] {
  return camposVisibles(campos, r)
    .filter((c) => c.required && vacia(r[c.key]))
    .map((c) => c.key);
}

/**
 * Las respuestas que llegan del formulario público, limpias.
 *
 * Solo las claves del formulario, con el tipo que toca y tamaño acotado; una
 * opción que no existe no se guarda. Al final se quitan las de preguntas que no
 * se ven: no se guarda la respuesta a algo que la persona no tuvo delante.
 */
export function limpiarRespuestas(campos: CampoDeFormulario[], raw: unknown): Respuestas {
  const entrada = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Respuestas = {};
  for (const c of campos) {
    const v = entrada[c.key];
    switch (c.type) {
      case 'checkbox':
        out[c.key] = v === true || v === 'true' || v === 'on';
        break;
      case 'multiselect': {
        const validas = new Set((c.options ?? []).map((o) => o.value));
        out[c.key] = Array.isArray(v) ? [...new Set(v.map(String))].filter((x) => validas.has(x)) : [];
        break;
      }
      case 'select':
      case 'radio': {
        const s = typeof v === 'string' ? v : '';
        out[c.key] = (c.options ?? []).some((o) => o.value === s) ? s : null;
        break;
      }
      case 'number': {
        const s = typeof v === 'number' ? String(v) : recortar(v, 30);
        out[c.key] = s && Number.isFinite(Number(s)) ? s : null;
        break;
      }
      case 'email': {
        // Sin «@» no es un correo: contaba como respuesta a una obligatoria y el
        // lead salía sin a quién escribir (Fable, 2026-09-15).
        const s = recortar(v, 160).toLowerCase();
        out[c.key] = s.includes('@') ? s : null;
        break;
      }
      case 'whatsapp': {
        // Sin dígitos suficientes no es un teléfono: el lead no tendría con qué
        // encontrarse ni a quién escribirle el recordatorio.
        const s = recortar(v, 40);
        out[c.key] = s.replace(/\D/g, '').length >= 7 ? s : null;
        break;
      }
      case 'date': {
        const s = recortar(v, 10);
        out[c.key] = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
        break;
      }
      case 'time': {
        const s = recortar(v, 5);
        out[c.key] = /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null;
        break;
      }
      case 'long_text':
        out[c.key] = recortar(v, 4000) || null;
        break;
      default:
        out[c.key] = recortar(v, 500) || null;
    }
  }
  const visibles = new Set(camposVisibles(campos, out).map((c) => c.key));
  for (const k of Object.keys(out)) if (!visibles.has(k)) delete out[k];
  return out;
}

/** Lo que el formulario dice del lead, según a qué dato apunta cada pregunta. */
export function datosDelLead(
  campos: CampoDeFormulario[],
  r: Respuestas,
): { name?: string; phone?: string; email?: string; company?: string; instagram?: string } {
  const out: { name?: string; phone?: string; email?: string; company?: string; instagram?: string } = {};
  let nombre = '';
  let apellido = '';
  for (const c of campos) {
    if (!c.maps_to) continue;
    const v = r[c.key];
    const val = Array.isArray(v) ? v.join(', ') : v == null || typeof v === 'boolean' ? '' : String(v).trim();
    if (!val) continue;
    switch (c.maps_to) {
      case 'first_name':
        nombre = val;
        break;
      case 'last_name':
        apellido = val;
        break;
      case 'name':
        out.name = val;
        break;
      // Solo si lo parecen: una pregunta de texto libre apuntada a WhatsApp
      // admite «no tengo», y ese lead no se deduplicaría nunca.
      case 'whatsapp':
        if (val.replace(/\D/g, '').length >= 7) out.phone = val;
        break;
      case 'email':
        if (val.includes('@')) out.email = val.toLowerCase();
        break;
      case 'company':
        out.company = val;
        break;
      case 'instagram':
        out.instagram = val;
        break;
    }
  }
  if (!out.name && (nombre || apellido)) out.name = `${nombre} ${apellido}`.trim();
  return out;
}

/**
 * Puntaje del formulario (lead score inicial de la referencia): por opción en
 * las de elegir, por pregunta contestada en el resto. Tope 100.
 */
export function puntajeDelFormulario(campos: CampoDeFormulario[], r: Respuestas): number {
  let total = 0;
  for (const c of campos) {
    const v = r[c.key];
    if (TIPOS_CON_OPCIONES.includes(c.type) && c.options?.length) {
      const elegidas = Array.isArray(v) ? v.map(String) : v != null && v !== '' ? [String(v)] : [];
      for (const e of elegidas) total += c.options.find((o) => o.value === e)?.score ?? 0;
    } else if (c.type === 'checkbox') {
      if (v === true) total += c.score ?? 0;
    } else if (!vacia(v)) {
      total += c.score ?? 0;
    }
  }
  return Math.max(0, Math.min(100, Math.round(total)));
}

/** El enlace público del formulario: minúsculas, sin tildes, con guiones. */
export function slugDeFormulario(nombre: string): string {
  return (
    (nombre || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'formulario'
  );
}

/**
 * La plantilla «de agenda»: las preguntas con las que TeamClubify arranca su
 * formulario de agendamiento (`defaultBookingFields`), con Instagram en lugar de
 * «web o Instagram» porque es el dato que el lead de Clubify PRO guarda.
 */
export const CAMPOS_DE_AGENDA: CampoDeFormulario[] = [
  { id: 'f_nombre', key: 'nombre', type: 'short_text', label: 'Nombre', required: true, maps_to: 'first_name', section: 'Tus datos' },
  { id: 'f_apellidos', key: 'apellidos', type: 'short_text', label: 'Apellidos', required: true, maps_to: 'last_name', section: 'Tus datos' },
  {
    id: 'f_whatsapp',
    key: 'whatsapp',
    type: 'whatsapp',
    label: 'WhatsApp',
    help: 'Con el indicativo de tu país.',
    required: true,
    maps_to: 'whatsapp',
    section: 'Tus datos',
  },
  {
    id: 'f_instagram',
    key: 'instagram',
    type: 'instagram',
    label: 'Instagram de tu negocio',
    placeholder: '@tunegocio',
    required: true,
    maps_to: 'instagram',
    section: 'Tu negocio',
  },
  {
    id: 'f_negocio',
    key: 'describe_negocio',
    type: 'long_text',
    label: 'Describe tu negocio',
    help: 'Cuéntanos a qué te dedicas y qué vendes.',
    required: true,
    section: 'Tu negocio',
  },
  {
    id: 'f_facturacion',
    key: 'facturacion',
    type: 'select',
    label: 'Facturación promedio mensual',
    required: true,
    section: 'Tu negocio',
    options: [
      { value: '0-1k', label: 'Menos de $1.000 USD' },
      { value: '1k-5k', label: '$1.000 – $5.000 USD' },
      { value: '5k-15k', label: '$5.000 – $15.000 USD' },
      { value: '15k-50k', label: '$15.000 – $50.000 USD' },
      { value: '50k+', label: 'Más de $50.000 USD' },
    ],
  },
  {
    id: 'f_invertir',
    key: 'dispuesto_invertir',
    type: 'radio',
    label: '¿Estás dispuesto a invertir para crecer tu negocio?',
    required: true,
    section: 'Tu negocio',
    options: [
      { value: 'si', label: 'Sí, estoy listo para invertir' },
      { value: 'no', label: 'Aún no / lo estoy evaluando' },
    ],
  },
  {
    id: 'f_motivo_no',
    key: 'motivo_no_invertir',
    type: 'long_text',
    label: '¿Cuál es el principal motivo?',
    help: 'Nos ayuda a preparar mejor tu reunión.',
    section: 'Tu negocio',
    condition: { when: 'dispuesto_invertir', op: 'eq', value: 'no' },
  },
];

/**
 * Las respuestas en texto, «Pregunta: respuesta» por línea y con la etiqueta de
 * cada opción, para las notas de la cita: el closer lo lee sin abrir nada más.
 */
export function resumenDeRespuestas(campos: CampoDeFormulario[], r: Respuestas, max = 1000): string {
  const lineas: string[] = [];
  for (const c of camposVisibles(campos, r)) {
    const v = r[c.key];
    const etiqueta = (x: string) => c.options?.find((o) => o.value === x)?.label ?? x;
    let t = '';
    if (Array.isArray(v)) t = v.map(etiqueta).join(', ');
    else if (typeof v === 'boolean') t = v ? 'Sí' : '';
    else if (v != null) t = etiqueta(String(v));
    if (t.trim()) lineas.push(`${c.label}: ${t.trim()}`);
  }
  const texto = lineas.join('\n');
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

/** El objeto de `SalesTeam.bookingConfig`, o `{}` si no es un objeto. */
export function configDeAgenda(json: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
}

/** El formulario que pide la agenda pública del equipo, o null (el de nombre y teléfono). */
export function formularioDeAgendaDe(json: Prisma.JsonValue | null | undefined): string | null {
  const id = configDeAgenda(json).formularioId;
  return typeof id === 'string' && id ? id : null;
}

/** Las preguntas guardadas, re-limpiadas: lo que haya en la base no se da por bueno. */
export function camposGuardados(json: unknown): CampoDeFormulario[] {
  const r = normalizarCampos(json);
  return Array.isArray(r) ? r : [];
}

/** Los datos con los que se puede crear el lead de quien reserva (`leadDeLaReservaPublica`). */
const DESTINOS_DE_CONTACTO: readonly DestinoEnElLead[] = ['first_name', 'last_name', 'name', 'whatsapp', 'email'];

/**
 * ¿Asegura el formulario un dato con el que crear el lead de quien reserva?
 *
 * Hace falta una pregunta obligatoria y sin condición —se ve siempre— que pase
 * al lead el nombre, el WhatsApp o el correo. Sin ella la reserva podía salir
 * sin lead: la cita no aparece en el tablero del closer y el recordatorio no
 * tiene a quién escribir. Una casilla no vale: su «sí» no es un dato. Y un
 * WhatsApp o un correo solo cuentan si la pregunta es de ese tipo: un texto
 * libre admite «no tengo» (Fable, 2026-09-15).
 */
export function pideDatoDeContacto(campos: CampoDeFormulario[]): boolean {
  return campos.some(
    (c) =>
      c.required === true &&
      !c.condition?.when &&
      c.type !== 'checkbox' &&
      !!c.maps_to &&
      DESTINOS_DE_CONTACTO.includes(c.maps_to) &&
      (c.maps_to === 'whatsapp' ? c.type === 'whatsapp' : c.maps_to === 'email' ? c.type === 'email' : true),
  );
}

/**
 * Las preguntas como las ve quien reserva: sin puntajes ni a qué dato del lead
 * va cada una. Con el JSON entero, quien reserva veía qué opción puntúa más y
 * podía jugar la calificación (Fable, 2026-09-15; la referencia lo enseña igual).
 */
export function camposParaElPublico(campos: CampoDeFormulario[]): CampoDeFormulario[] {
  return campos.map((c) => {
    const p: CampoDeFormulario = { ...c };
    delete p.score;
    delete p.maps_to;
    if (c.options) p.options = c.options.map((o) => ({ value: o.value, label: o.label }));
    return p;
  });
}
