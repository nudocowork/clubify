// ── MOTOR DE EMAIL MARKETING — tipos + catálogos + helpers puros ──
// Audiencia: los CONTACTOS (leads/clientes) de la marca. Correo/SMS por la
// subcuenta del proveedor de la marca (envoltorio en provider/).

// Los filtros, los operadores y la lista de disparadores son los MISMOS que en
// el constructor de negocios: se importan de allí en vez de copiarse, porque
// deciden a quién le llega un mensaje y dos copias se separan a la primera
// corrección (ya pasó con el catálogo de la pantalla).
import {
  evalWF,
  operadoresDe,
  sinAcentos,
  type WFCondition,
  type WFTrigger,
} from '../superadmin/brand-workflows/wf-filtros.util';

export { evalWF, sinAcentos };
export type { WFCondition, WFTrigger };

export type WFNode = {
  id: string;
  type: string;
  config: Record<string, unknown>;
  next?: string | null;
  yes?: string | null;
  no?: string | null;
  /** Una salida por caso, para los pasos que abren N ramas (`branch_reply`). */
  branches?: Record<string, string | null>;
};
export type WFGraph = Record<string, WFNode>;
export type WFDrip = { enabled?: boolean; batchSize?: number; intervalMinutes?: number };
export type WFSendWindow = {
  enabled?: boolean;
  startHour?: number;
  endHour?: number;
  skipWeekends?: boolean;
  tz?: string;
};

/**
 * CATÁLOGO ÚNICO del constructor de contactos.
 *
 * Hasta el 2026-09-21 esto no lo importaba NADIE: el catálogo de verdad vivía
 * copiado a mano en `EmailMarketingWorkflows.tsx`, y por eso la pantalla
 * ofrecía el disparador `tag_added` —con su campo de etiqueta y todo— cuando
 * en el repo no existía un solo `fireTrigger('tag_added')`: quien lo
 * configuraba se quedaba esperando un flujo que no arrancaba nunca. Ahora la
 * pantalla lo pide por `GET /admin/marketing/workflows/catalogo` y esto es lo
 * único que hay que tocar para añadir un disparador o un paso.
 *
 * Regla que sostiene el archivo: aquí solo entra lo que el motor EJECUTA y lo
 * que algo del producto DISPARA. `mkt-pasos.spec.ts` lo comprueba leyendo el
 * código: un paso sin `case` en el motor, o un disparador sin `fireTrigger`,
 * ponen la prueba en rojo.
 *
 * Cada campo trae lo que la pantalla necesita para dibujar su formulario sola.
 */
export type CampoDeConfig = {
  key: string;
  label: string;
  /** Qué control pinta la pantalla. `condiciones`, `casos` y `cabeceras` son editores propios. */
  tipo:
    | 'texto'
    | 'textarea'
    | 'numero'
    | 'select'
    | 'fechaHora'
    | 'condiciones'
    | 'casos'
    | 'cabeceras'
    | 'flujo';
  /** `singular` es la forma para «1» en el resumen de la tarjeta: «1 día», no «1 días». */
  opciones?: { value: string; label: string; singular?: string }[];
  def?: string | number;
  ayuda?: string;
  /** Sin esto el paso no se puede guardar. */
  requerido?: boolean;
};

/**
 * Sobre qué se puede filtrar un disparador y con qué nace un filtro nuevo.
 *
 * Va POR DISPARADOR porque cada uno trae datos distintos: «Contenido de la
 * respuesta» solo existe cuando el contacto responde, y la columna del tablero
 * solo en los de ventas. Ofrecer un campo que el disparador no rellena es un
 * filtro que no casa nunca — y un flujo que no arranca sin que nadie sepa por qué.
 */
export type FiltrosDelDisparador = {
  /** Vacío = este disparador no admite filtros (la inscripción manual). */
  campos: { key: string; label: string }[];
  /** Claves de `operadores` del catálogo que se ofrecen. */
  operadores: string[];
  nuevo: { field: string; op: string };
};

export type DisparadorDeContactos = {
  key: string;
  label: string;
  grupo: 'General' | 'Contacto' | 'Ventas';
  /** Cada cuánto se mira: en tiempo real, o en el barrido de cada hora. */
  latencia: 'minutos' | 'hora';
  hint?: string;
  campos?: CampoDeConfig[];
  /** Lo pone `catalogoDeContactos`: es derivado, no se escribe a mano. */
  filtros?: FiltrosDelDisparador;
};

export type PasoDeContactos = {
  key: string;
  label: string;
  grupo: 'Mensaje' | 'Espera' | 'Lógica' | 'Contacto' | 'Integración' | 'Salida';
  icono: string;
  /** Cómo se dibuja debajo: una salida, dos ramas, o una por caso. */
  ramas?: 'siNo' | 'casos';
  /** Etiquetas de las dos ramas cuando no son «Sí» y «No». */
  ramaSi?: string;
  ramaNo?: string;
  hint?: string;
  campos: CampoDeConfig[];
  /**
   * Plantilla del resumen de la tarjeta: `{clave}` se cambia por el valor del
   * campo (el texto de la opción, en los desplegables). Sin plantilla, la
   * pantalla junta los valores tal cual.
   */
  resumen?: string;
};

const UNIDADES = [
  { value: 'minutes', label: 'minutos' },
  { value: 'hours', label: 'horas' },
  { value: 'days', label: 'días' },
  { value: 'weeks', label: 'semanas' },
];

// Las de «Esperar respuesta». Sin semanas: una respuesta que tarda más de unos
// días ya no es respuesta a ESE mensaje, y el flujo tiene que seguir.
const UNIDADES_DE_ESPERA = [
  { value: 'minutes', label: 'minutos', singular: 'minuto' },
  { value: 'hours', label: 'horas', singular: 'hora' },
  { value: 'days', label: 'días', singular: 'día' },
];

/**
 * Lo que espera «Esperar respuesta» cuando el paso no dice nada: 3 días, lo que
 * esperaba SIEMPRE antes de que se pudiera configurar. Los flujos publicados
 * tienen el paso con la configuración vacía y tienen que seguir esperando esto.
 */
export const ESPERA_DE_RESPUESTA_POR_DEFECTO = { amount: 3, unit: 'days' } as const;

const MS_POR_UNIDAD: Record<string, number> = {
  minutes: 60000,
  hours: 3600000,
  days: 86400000,
  weeks: 604800000,
};

/**
 * Cuánto espera «Esperar respuesta» antes de seguir por «Sin respuesta».
 *
 * Una cantidad que no es un número positivo vuelve ENTERA a los 3 días (no
 * «3 horas» si la unidad eran horas): es el único valor del que sabemos que
 * alguien lo quiso. Tope de un año: una cantidad absurda (un cero de más) daría
 * una fecha que la base no guarda y la inscripción se quedaría en error.
 */
export function msDeEsperaDeRespuesta(cfg: Record<string, unknown> | undefined): number {
  const def = ESPERA_DE_RESPUESTA_POR_DEFECTO;
  const cantidad = Number(cfg?.amount);
  if (!Number.isFinite(cantidad) || cantidad <= 0) return def.amount * MS_POR_UNIDAD[def.unit];
  const unidad = MS_POR_UNIDAD[String(cfg?.unit ?? def.unit)] ?? MS_POR_UNIDAD[def.unit];
  return Math.min(cantidad * unidad, 365 * MS_POR_UNIDAD.days);
}

const CAMPO_ETIQUETA: CampoDeConfig = {
  key: 'tag',
  label: 'Etiqueta',
  tipo: 'texto',
  ayuda: 'Déjalo vacío para que valga cualquier etiqueta.',
};

// Disparadores contact-based. `manual` inscribe desde una lista.
export const MKT_TRIGGERS: DisparadorDeContactos[] = [
  { key: 'manual', label: 'Inscripción manual / lista', grupo: 'General', latencia: 'minutos', hint: 'Los metes tú desde la pestaña «Inscribir».' },

  // ── El contacto ──
  {
    key: 'contact_created',
    label: 'Contacto nuevo',
    grupo: 'Contacto',
    latencia: 'minutos',
    hint: 'Al dar de alta un contacto entra al momento. Los que llegan por importación o desde el tablero de ventas se recogen en la revisión de cada hora.',
  },
  {
    key: 'tag_added',
    label: 'Etiqueta agregada',
    grupo: 'Contacto',
    latencia: 'minutos',
    hint: 'Cuando se le pone una etiqueta: desde un paso «Agregar etiqueta», al sincronizar los negocios de la marca o al dar de alta el contacto con etiquetas.',
    campos: [CAMPO_ETIQUETA],
  },
  {
    key: 'tag_removed',
    label: 'Etiqueta eliminada',
    grupo: 'Contacto',
    latencia: 'minutos',
    hint: 'Cuando un paso «Quitar etiqueta» se la retira. Sirve para deshacer: sale de «clientes» → empieza la secuencia de recuperación.',
    campos: [CAMPO_ETIQUETA],
  },
  { key: 'email_reply', label: 'Responde / interactúa', grupo: 'Contacto', latencia: 'minutos', hint: 'Cuando el contacto responde, abre o hace clic en un correo.' },

  // ── Equipos de ventas ──
  // Cada evento es su propio disparador en vez de uno solo con un filtro,
  // porque «ganado» y «perdido» piden mensajes opuestos y esconderlos detrás
  // de una condición es la forma de mandarle el equivocado a alguien.
  { key: 'sales_lead_created', label: 'Lead nuevo (equipo de ventas)', grupo: 'Ventas', latencia: 'minutos', hint: 'Cuando entra un lead al tablero de un equipo, venga de donde venga.' },
  { key: 'sales_stage_changed', label: 'El lead cambia de columna', grupo: 'Ventas', latencia: 'minutos', hint: 'Al mover la tarjeta. Condición sobre «etapa» para una columna concreta.' },
  { key: 'sales_lead_won', label: 'Lead ganado', grupo: 'Ventas', latencia: 'minutos', hint: 'Al pasar a la columna de clientes.' },
  { key: 'sales_lead_lost', label: 'Lead perdido', grupo: 'Ventas', latencia: 'minutos', hint: 'Al pasar a la columna de no interesados.' },
  { key: 'sales_meeting_booked', label: 'Cita agendada', grupo: 'Ventas', latencia: 'minutos', hint: 'Cuando queda una cita, la ponga el vendedor o el propio prospecto.' },
  { key: 'sales_meeting_no_show', label: 'No asistió a la cita', grupo: 'Ventas', latencia: 'minutos', hint: 'Cuando el vendedor marca la cita como «no asistió».' },
];

/**
 * Los campos del contacto que un flujo puede ESCRIBIR.
 *
 * Lista blanca, y corta a propósito: `email` y `phone` son la IDENTIDAD. De
 * ellos cuelgan `phoneKey`/`phoneNorm` y los índices únicos parciales de
 * producción, y la única puerta que sabe mantenerlos coherentes es
 * `resolveContact` (identity.ts). Un flujo que escribiera el teléfono a pelo
 * partiría la ficha en dos o reventaría el índice.
 */
export const MKT_CAMPOS_EDITABLES: { value: string; label: string }[] = [
  { value: 'name', label: 'Nombre' },
  { value: 'company', label: 'Empresa' },
];

export const MKT_NODE_TYPES: PasoDeContactos[] = [
  // ── Mensaje ──
  {
    key: 'send_email',
    label: 'Enviar correo',
    grupo: 'Mensaje',
    icono: '✉️',
    hint: 'Al correo del contacto, por la subcuenta de la marca. El cuerpo admite HTML.',
    campos: [
      { key: 'subject', label: 'Asunto', tipo: 'texto', requerido: true },
      { key: 'body', label: 'Contenido', tipo: 'textarea', requerido: true, ayuda: 'Admite {{nombre}}, {{empresa}}…' },
    ],
  },
  {
    key: 'send_sms',
    label: 'Enviar SMS',
    grupo: 'Mensaje',
    icono: '💬',
    hint: 'Al teléfono del contacto, por la subcuenta de la marca.',
    campos: [{ key: 'message', label: 'Mensaje', tipo: 'textarea', requerido: true }],
  },
  {
    key: 'notify_team',
    label: 'Avisar al equipo',
    grupo: 'Mensaje',
    icono: '🔔',
    hint: 'A vosotros, no al contacto: «Fulano acaba de responder». Sale por la misma subcuenta de la marca.',
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
    label: 'Espera (tiempo)',
    grupo: 'Espera',
    icono: '⏱',
    campos: [
      { key: 'amount', label: 'Cuánto', tipo: 'numero', def: 1 },
      { key: 'unit', label: 'Unidad', tipo: 'select', def: 'days', opciones: UNIDADES },
    ],
  },
  {
    key: 'wait_datetime',
    label: 'Esperar hasta fecha/hora',
    grupo: 'Espera',
    icono: '📅',
    hint: 'Hora de Bogotá. Si la fecha ya pasó, sigue de largo en vez de dejar al contacto colgado.',
    campos: [{ key: 'at', label: 'Esperar hasta', tipo: 'fechaHora', requerido: true }],
  },
  {
    key: 'wait_reply',
    label: 'Esperar respuesta',
    grupo: 'Espera',
    icono: '⏳',
    ramas: 'siNo',
    ramaSi: 'Respondió',
    ramaNo: 'Sin respuesta',
    hint: 'Espera a que el contacto responda, abra o haga clic. Si pasa el tiempo máximo sin nada, sigue por «Sin respuesta». Un «entregado» NO cuenta.',
    campos: [
      {
        key: 'amount',
        label: 'Tiempo máximo',
        tipo: 'numero',
        def: ESPERA_DE_RESPUESTA_POR_DEFECTO.amount,
        ayuda: 'Pasado este tiempo sin respuesta, sigue por «Sin respuesta».',
      },
      { key: 'unit', label: 'Unidad', tipo: 'select', def: ESPERA_DE_RESPUESTA_POR_DEFECTO.unit, opciones: UNIDADES_DE_ESPERA },
    ],
    resumen: 'Espera respuesta · {amount} {unit}',
  },

  // ── Lógica ──
  {
    key: 'condition',
    label: 'Si / No (condición)',
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
    key: 'branch',
    label: 'Bifurcar A/B',
    grupo: 'Lógica',
    icono: '⑃',
    ramas: 'siNo',
    ramaSi: 'A',
    ramaNo: 'B',
    hint: 'Para probar dos mensajes. El reparto es fijo por contacto: el mismo contacto cae siempre en la misma rama.',
    campos: [{ key: 'percent', label: 'Porcentaje que va a la rama A', tipo: 'numero', def: 50 }],
  },
  {
    key: 'branch_reply',
    label: 'Ramas por respuesta',
    grupo: 'Lógica',
    icono: '⑂',
    ramas: 'casos',
    hint: 'Mira LO QUE CONTESTÓ el contacto y elige rama. Va justo después de «Esperar respuesta», en la rama «Respondió»: en cualquier otro sitio no hay texto que mirar y todo se iría por «Cualquier otra».',
    campos: [
      {
        key: 'casos',
        label: 'Casos',
        tipo: 'casos',
        requerido: true,
        ayuda: 'Palabras separadas por coma. Gana el primer caso que case; no distingue mayúsculas ni tildes.',
      },
    ],
  },

  // ── El contacto ──
  {
    key: 'add_tag',
    label: 'Agregar etiqueta',
    grupo: 'Contacto',
    icono: '🏷',
    hint: 'Se suma a las que ya tiene. Dispara los flujos que escuchan «Etiqueta agregada».',
    campos: [{ key: 'tag', label: 'Etiqueta a agregar', tipo: 'texto', requerido: true }],
  },
  {
    key: 'remove_tag',
    label: 'Quitar etiqueta',
    grupo: 'Contacto',
    icono: '🧹',
    hint: 'Quita SOLO esa etiqueta y deja las demás. Dispara los flujos que escuchan «Etiqueta eliminada».',
    campos: [{ key: 'tag', label: 'Etiqueta a quitar', tipo: 'texto', requerido: true }],
  },
  {
    key: 'update_field',
    label: 'Actualizar un dato',
    grupo: 'Contacto',
    icono: '✏️',
    hint: 'Solo nombre y empresa. El correo y el teléfono son la identidad del contacto y no se tocan desde aquí.',
    campos: [
      { key: 'campo', label: 'Dato', tipo: 'select', def: 'name', opciones: MKT_CAMPOS_EDITABLES, requerido: true },
      { key: 'valor', label: 'Nuevo valor', tipo: 'texto', requerido: true, ayuda: 'Admite {{merge}}. Si queda vacío no se escribe nada: un dato no se borra sin querer.' },
    ],
  },

  // ── Integración ──
  {
    key: 'webhook',
    label: 'Webhook',
    grupo: 'Integración',
    icono: '🔗',
    hint: 'Avisa a otro sistema. El cuerpo por defecto lleva los datos del contacto.',
    campos: [
      { key: 'url', label: 'URL', tipo: 'texto', requerido: true, ayuda: 'Tiene que ser pública: no se llama a direcciones de nuestra propia red.' },
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
      { key: 'body', label: 'Cuerpo (JSON)', tipo: 'textarea', ayuda: 'Vacío = los datos del contacto.' },
    ],
  },
  {
    key: 'goto_workflow',
    label: 'Pasar a otro flujo',
    grupo: 'Integración',
    icono: '➡️',
    hint: 'Saca al contacto de este flujo y lo mete en otro de la misma marca, ya publicado.',
    campos: [{ key: 'workflowId', label: 'Flujo destino', tipo: 'flujo', requerido: true }],
  },

  // ── Salida ──
  { key: 'end', label: 'Terminar el flujo', grupo: 'Salida', icono: '🚪', hint: 'Saca al contacto del flujo aquí mismo.', campos: [] },
];

// Campos del contacto para condiciones.
export const MKT_FIELDS: { key: string; label: string }[] = [
  { key: 'nombre', label: 'Nombre' },
  { key: 'email', label: 'Correo' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'empresa', label: 'Empresa' },
  { key: 'tags', label: 'Etiquetas' },
  // Solo traen valor cuando el disparador los pone. En los demás llegan
  // vacíos, y una condición sobre un campo vacío no casa — que es lo correcto:
  // un flujo de «contacto nuevo» no debería colarse por la etapa de un lead.
  { key: 'respuesta', label: 'Texto de la última respuesta' },
  { key: 'etiqueta', label: 'Etiqueta del disparador' },
  { key: 'etapa', label: 'Columna del tablero (ventas)' },
  { key: 'equipo', label: 'Equipo de ventas' },
  { key: 'vendedor', label: 'Vendedor asignado (ventas)' },
];

export const MKT_MERGE_FIELDS: { key: string; label: string }[] = [
  { key: 'nombre', label: 'Nombre del contacto' },
  { key: 'email', label: 'Correo' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'empresa', label: 'Empresa' },
  { key: 'marca', label: 'Nombre de la marca' },
  { key: 'respuesta', label: 'Lo que respondió' },
  { key: 'etapa', label: 'Columna del tablero (ventas)' },
  { key: 'equipo', label: 'Equipo de ventas' },
  { key: 'vendedor', label: 'Vendedor asignado (ventas)' },
];

/** Los operadores del constructor de contactos: los 12, etiquetas incluidas. */
export const MKT_OPERADORES = operadoresDe(true);

// Lo que trae SIEMPRE el contexto de un contacto, venga de donde venga.
const CAMPOS_DEL_CONTACTO = MKT_FIELDS.filter((f) => ['nombre', 'email', 'telefono', 'empresa', 'tags'].includes(f.key));
const campoDe = (key: string, label?: string) => ({ key, label: label ?? MKT_FIELDS.find((f) => f.key === key)?.label ?? key });

/**
 * Sobre qué puede filtrar cada disparador: los datos del contacto más lo que
 * ESE disparador pone en el contexto (lo que manda `fireTrigger` en `extra`).
 */
export function filtrosDelDisparador(key: string): FiltrosDelDisparador {
  const operadores = MKT_OPERADORES.map((o) => o.value);
  // La inscripción manual no pasa por `fireTrigger`: entra quien inscribas, y
  // un filtro ahí sería una promesa que el motor no cumple.
  if (key === 'manual') return { campos: [], operadores, nuevo: { field: 'tags', op: 'has_tag' } };
  if (key === 'email_reply') {
    return {
      campos: [campoDe('respuesta', 'Contenido de la respuesta'), ...CAMPOS_DEL_CONTACTO],
      operadores,
      // Lo que se filtra casi siempre de una respuesta es qué dijo.
      nuevo: { field: 'respuesta', op: 'contains' },
    };
  }
  if (['sales_lead_created', 'sales_stage_changed', 'sales_lead_won', 'sales_lead_lost'].includes(key)) {
    const conAnterior = key !== 'sales_lead_created';
    return {
      campos: [
        campoDe('etapa'),
        ...(conAnterior ? [campoDe('etapa_anterior', 'Columna de la que viene (ventas)')] : []),
        campoDe('equipo'),
        campoDe('vendedor'),
        ...CAMPOS_DEL_CONTACTO,
      ],
      operadores,
      nuevo: { field: 'etapa', op: 'eq' },
    };
  }
  if (key === 'sales_meeting_booked' || key === 'sales_meeting_no_show') {
    return { campos: [campoDe('equipo'), campoDe('vendedor'), ...CAMPOS_DEL_CONTACTO], operadores, nuevo: { field: 'equipo', op: 'eq' } };
  }
  return { campos: CAMPOS_DEL_CONTACTO, operadores, nuevo: { field: 'tags', op: 'has_tag' } };
}

/** Lo que la pantalla necesita para dibujarse entera. Una sola copia, esta. */
export function catalogoDeContactos() {
  return {
    disparadores: MKT_TRIGGERS.map((d) => ({ ...d, filtros: filtrosDelDisparador(d.key) })),
    pasos: MKT_NODE_TYPES,
    campos: MKT_FIELDS,
    merge: MKT_MERGE_FIELDS,
    operadores: MKT_OPERADORES,
  };
}

/** Un caso de «Ramas por respuesta»: una salida del nodo + las palabras que la eligen. */
export type WFCaso = { id: string; label?: string; palabras?: string };

/**
 * Qué caso casa con lo que respondió el contacto. Devuelve el id del primero
 * que case, o null.
 *
 * Una palabra suelta casa por PALABRA COMPLETA y no por trozo: con «contiene»,
 * un caso configurado como «no» se llevaría «nos interesa», que es justo lo
 * contrario de lo que quiso decir. Una frase («no me interesa») sí se busca tal
 * cual dentro del texto, porque ahí el usuario ya está siendo específico.
 */
export function casoQueCasa(texto: string, casos: WFCaso[] | undefined): string | null {
  const t = sinAcentos(texto).trim();
  if (!t || !casos?.length) return null;
  const tokens = new Set(t.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  for (const caso of casos) {
    if (!caso?.id) continue;
    const palabras = String(caso.palabras ?? '')
      .split(/[,\n]/)
      .map((p) => sinAcentos(p).trim())
      .filter(Boolean);
    for (const p of palabras) {
      const casa = /[^\p{L}\p{N}]/u.test(p) ? t.includes(p) : tokens.has(p);
      if (casa) return caso.id;
    }
  }
  return null;
}

/**
 * Tope de saltos entre flujos.
 *
 * Dos flujos que se apunten el uno al otro —con «Pasar a otro flujo» o con una
 * etiqueta que dispara al otro— se pasarían el contacto para siempre, y cada
 * vuelta manda los mensajes de en medio. El tope de 60 nodos del motor no cubre
 * esto porque solo acota UNA pasada.
 */
export const MKT_MAX_SALTOS = 10;

/** Reemplaza {{campo}} por su valor del contexto (vacío si no existe). */
export function resolveMerge(text: string, ctx: Record<string, string>): string {
  return (text || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => {
    const key = String(k).trim();
    return ctx[key] != null ? ctx[key] : '';
  });
}

/**
 * Versión en texto plano de un correo HTML, para la parte `text` del envío.
 *
 * Se deriva del HTML (y no de los bloques) a propósito: el HTML es lo único
 * que tienen TODAS las plantillas —incluidas las importadas de otra
 * herramienta, que llegan sin bloques que recorrer—. Un correo solo-HTML
 * puntúa peor en los filtros antispam y no se lee en clientes sin HTML.
 */
export function htmlToText(html: string): string {
  return String(html || '')
    // Primero los comentarios: se lleva el VML de Outlook y los condicionales.
    // Al ser no-codicioso, `<!--[if !mso]><!-- -->` desaparece entero y deja
    // dentro el <a> real, que es justo lo que queremos conservar.
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Relleno invisible del preheader: si no se quita, el texto plano empieza
    // con una tira de caracteres raros.
    .replace(/&#8199;|&#65279;|&#847;|&zwnj;/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|td)>/gi, '\n')
    .replace(/<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, txt: string) => {
      const etiqueta = txt.replace(/<[^>]+>/g, '').trim();
      const url = String(href).trim();
      if (!url || url === '#') return etiqueta;
      return etiqueta && etiqueta !== url ? `${etiqueta}: ${url}` : url;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
