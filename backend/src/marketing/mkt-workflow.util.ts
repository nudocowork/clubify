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
    | 'flujo'
    | 'paso';
  /** `singular` es la forma para «1» en el resumen de la tarjeta: «1 día», no «1 días». */
  opciones?: { value: string; label: string; singular?: string }[];
  /**
   * De qué lista de la MARCA se completan las opciones al servir el catálogo.
   *
   * Los embudos, las etapas y los miembros son datos de los equipos de ventas
   * de cada marca, no una lista fija: van en el catálogo —que ya es por
   * marca— y no en la pantalla, porque una segunda copia en el front es
   * exactamente cómo se desincronizó el catálogo la vez anterior. Lo que
   * declare `opciones` se queda delante (el «— cualquiera —» de cabecera).
   */
  catalogo?: 'embudos' | 'etapas' | 'miembros' | 'plantillas';
  def?: string | number;
  ayuda?: string;
  /** Sin esto el paso no se puede guardar. */
  requerido?: boolean;
  /**
   * No se pinta cuando ESE otro campo del paso tiene valor.
   *
   * Existe por «Enviar correo»: con una plantilla elegida, el cuerpo escrito en
   * el paso no se manda. Dejarlo a la vista invita a escribir un correo que
   * nadie va a leer. Un campo oculto tampoco cuenta como obligatorio.
   */
  ocultoSi?: string;
  /** Obligatorio SALVO que ese otro campo del paso tenga valor. */
  requeridoSalvo?: string;
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
  grupo: 'Mensaje' | 'Espera' | 'Lógica' | 'Contacto' | 'Ventas' | 'Integración' | 'Salida';
  icono: string;
  /** Cómo se dibuja debajo: una salida, dos ramas, o una por caso. */
  ramas?: 'siNo' | 'casos';
  /** Etiquetas de las dos ramas cuando no son «Sí» y «No». */
  ramaSi?: string;
  ramaNo?: string;
  hint?: string;
  campos: CampoDeConfig[];
  /**
   * Este paso MANDA algo, y por qué canal. La pantalla dibuja «Enviar prueba»
   * con esto, en vez de con una lista de tipos de paso escrita a mano que se
   * olvidaría de actualizar el día que haya un canal más.
   */
  prueba?: 'sms' | 'email';
  /**
   * Plantilla del resumen de la tarjeta: `{clave}` se cambia por el valor del
   * campo (el texto de la opción, en los desplegables). Sin plantilla, la
   * pantalla junta los valores tal cual.
   */
  resumen?: string;
};

const UNIDADES = [
  { value: 'minutes', label: 'minutos', singular: 'minuto' },
  { value: 'hours', label: 'horas', singular: 'hora' },
  { value: 'days', label: 'días', singular: 'día' },
  { value: 'weeks', label: 'semanas', singular: 'semana' },
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

export const MS_POR_UNIDAD: Record<string, number> = {
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

// ── Equipos de ventas: los valores que existen de verdad ───────────────────

/**
 * Los estados de cita que se pueden escuchar.
 *
 * Son los de `SalesMeeting.status` MENOS `PENDIENTE`: una cita nace pendiente,
 * así que escuchar ese estado sería escuchar «cita agendada» —que ya tiene su
 * propio disparador— dos veces.
 *
 * NO hay «reagendada»: Clubify PRO no tiene ese estado (lo dicen
 * `sales-teams/agenda-del-dia.ts` y `configuracion-de-equipo.ts`). Aquí
 * reagendar es mover la cita de hora, y la cita vuelve a `PENDIENTE`.
 */
export const ESTADOS_DE_CITA: { value: string; label: string }[] = [
  { value: 'CONFIRMADA', label: 'Confirmada' },
  { value: 'REALIZADA', label: 'Realizada' },
  { value: 'NO_ASISTIO', label: 'No asistió' },
  { value: 'CANCELADA', label: 'Cancelada' },
];

/**
 * Desde qué estados una cita todavía se puede confirmar o cancelar.
 *
 * `REALIZADA` y `NO_ASISTIO` son un DESENLACE: reescribirlos desde un flujo
 * borraría lo que pasó de verdad en la reunión. En TeamClubify eso escondió 50
 * plantones —aparecían 8 de ~58— porque un paso «cancelar cita» corría 15 h
 * después del plantón y volteaba el `no_show` a `cancelada`.
 */
export const ESTADOS_DE_CITA_VIVA = ['PENDIENTE', 'CONFIRMADA'];

/** Los cuatro estados de una oportunidad, para leerlos (filtros y {{merge}}). */
export const ESTADOS_DE_OPORTUNIDAD: { value: string; label: string }[] = [
  { value: 'abierta', label: 'Abierta' },
  { value: 'ganada', label: 'Ganada' },
  { value: 'perdida', label: 'Perdida' },
  { value: 'abandonada', label: 'Abandonada' },
];

/**
 * Los estados que un flujo puede ESCRIBIR en una oportunidad. Falta «ganada» a
 * propósito.
 *
 * Ganar una oportunidad en el CRM no es escribir una palabra: mueve el lead a
 * la columna de clientes, le pone el valor de la venta y dispara
 * `sales_lead_won` (`crm-de-equipo.service.ts`, y si algo de eso falla se
 * deshace el cambio). Ese camino vive en el módulo de ventas y desde aquí no se
 * puede llamar sin dejar los dos módulos dependiendo el uno del otro. Escribir
 * «ganada» a pelo dejaría la oportunidad ganada sin venta y sin implementación
 * — el bug que ese archivo ya tuvo una vez.
 */
export const ESTADOS_DE_OPORTUNIDAD_DEL_FLUJO: { value: string; label: string }[] = [
  { value: 'abierta', label: 'Abierta' },
  { value: 'perdida', label: 'Perdida' },
  { value: 'abandonada', label: 'Abandonada' },
];

const CUALQUIERA = { value: '', label: '— cualquiera —' };

/** El embudo por el que filtra un disparador. Vacío = cualquiera. */
const FILTRO_EMBUDO: CampoDeConfig = {
  key: 'embudo',
  label: 'Solo de este embudo',
  tipo: 'select',
  def: '',
  opciones: [CUALQUIERA],
  catalogo: 'embudos',
  ayuda: 'Se compara por NOMBRE: vale para el embudo con ese nombre de cualquier equipo de la marca.',
};

/** La etapa por la que filtra un disparador. Vacío = cualquiera. */
const FILTRO_ETAPA: CampoDeConfig = {
  key: 'etapa',
  label: 'Solo de esta etapa',
  tipo: 'select',
  def: '',
  opciones: [CUALQUIERA],
  catalogo: 'etapas',
  ayuda: 'También por nombre. Déjalo en «cualquiera» para que valga toda etapa del embudo.',
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
  {
    key: 'contact_updated',
    label: 'Contacto actualizado',
    grupo: 'Contacto',
    latencia: 'minutos',
    hint: 'Cuando cambia un dato de la ficha: lo escribe un paso «Actualizar un dato», lo rellena la sincronización de negocios o vuelve un contacto que estaba dado de baja. Poner una etiqueta NO cuenta: para eso está «Etiqueta agregada».',
  },

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
  {
    key: 'sales_meeting_status',
    label: 'Estado de la cita cambió',
    grupo: 'Ventas',
    latencia: 'hora',
    hint: 'Confirmada, realizada, no asistió o cancelada. Se revisa cada hora y entra UNA vez por cada estado al que llega la cita: si vuelve a un estado por el que ya pasó, no se repite.',
    campos: [
      {
        key: 'estado',
        label: 'Solo cuando pasa a',
        tipo: 'select',
        def: '',
        opciones: [CUALQUIERA, ...ESTADOS_DE_CITA],
        ayuda: 'Una cita recién agendada no entra por aquí: para eso está «Cita agendada».',
      },
    ],
  },
  {
    key: 'sales_opportunity_created',
    label: 'Oportunidad creada',
    grupo: 'Ventas',
    latencia: 'hora',
    hint: 'Cuando se abre una oportunidad en el CRM del equipo, la abra una persona o un flujo.',
    campos: [FILTRO_EMBUDO, FILTRO_ETAPA],
  },
  // «Oportunidad cambió de etapa» NO está, a propósito (2026-09-23). El barrido
  // solo puede ver que la fila se tocó, no que la tarjeta se movió: corregir el
  // monto de una oportunidad disparaba «pasaste a Contactado» al cliente. Vuelve
  // cuando el módulo de ventas deje una marca del movimiento (una fecha de
  // último cambio de etapa, o un evento propio).
  {
    key: 'sales_opportunity_status',
    label: 'Oportunidad ganada o perdida',
    grupo: 'Ventas',
    latencia: 'hora',
    hint: 'Cuando la oportunidad se cierra: ganada, perdida o abandonada.',
    campos: [
      FILTRO_EMBUDO,
      {
        key: 'estado',
        label: 'Solo cuando queda',
        tipo: 'select',
        def: '',
        opciones: [
          CUALQUIERA,
          ...ESTADOS_DE_OPORTUNIDAD.filter((e) => e.value !== 'abierta'),
        ],
      },
    ],
  },
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
    prueba: 'email',
    campos: [
      {
        key: 'templateId',
        label: 'Plantilla',
        tipo: 'select',
        def: '',
        catalogo: 'plantillas',
        opciones: [{ value: '', label: 'Sin plantilla (escribo el cuerpo aquí)' }],
        ayuda: 'Se guarda una referencia, no una copia: si editas la plantilla, el flujo manda la versión nueva.',
      },
      { key: 'subject', label: 'Asunto', tipo: 'texto', requerido: true, requeridoSalvo: 'templateId', ayuda: 'Con plantilla, si lo dejas vacío se usa el asunto de la plantilla.' },
      { key: 'body', label: 'Contenido', tipo: 'textarea', requerido: true, ocultoSi: 'templateId', ayuda: 'Admite {{nombre}}, {{empresa}}…' },
    ],
  },
  {
    key: 'send_sms',
    label: 'Enviar SMS',
    grupo: 'Mensaje',
    icono: '💬',
    hint: 'Al teléfono del contacto, por la subcuenta de la marca.',
    prueba: 'sms',
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
  {
    key: 'wait_appointment',
    label: 'Esperar respecto a la cita',
    grupo: 'Espera',
    icono: '📅',
    hint: 'Espera hasta X antes o después de la próxima cita del contacto con el equipo de ventas. Sirve para el recordatorio de la víspera y para el seguimiento del día después.',
    campos: [
      {
        key: 'direction',
        label: 'Cuándo',
        tipo: 'select',
        def: 'before',
        opciones: [
          { value: 'before', label: 'antes de la cita' },
          { value: 'after', label: 'después de la cita' },
        ],
      },
      { key: 'amount', label: 'Cuánto', tipo: 'numero', def: 1 },
      { key: 'unit', label: 'Unidad', tipo: 'select', def: 'hours', opciones: UNIDADES },
      {
        key: 'sinCita',
        label: 'Si todavía no tiene cita',
        tipo: 'select',
        def: 'esperar',
        opciones: [
          { value: 'esperar', label: 'esperar a que agende (revisa cada 6 horas)' },
          { value: 'seguir', label: 'seguir el flujo igual' },
        ],
        ayuda: 'Con «seguir», los mensajes que vengan detrás salen TODOS de golpe: el contacto aún no tiene reunión de la que hablar.',
      },
      {
        key: 'siYaPaso',
        label: 'Si ese momento ya pasó',
        tipo: 'select',
        def: 'auto',
        opciones: [
          { value: 'auto', label: 'lo sensato (antes: sacarlo · después: seguir)' },
          { value: 'seguir', label: 'seguir el flujo (el mensaje sale tarde)' },
          { value: 'salir', label: 'sacarlo del flujo' },
        ],
        ayuda: 'Pasa cuando el contacto entra al flujo con la cita casi encima: el recordatorio de «24 horas antes» ya no tiene sentido.',
      },
    ],
    resumen: '{amount} {unit} {direction}',
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
  {
    key: 'goto_node',
    label: 'Ir a un paso de este flujo',
    grupo: 'Lógica',
    icono: '↪️',
    hint: 'Manda al contacto a otro paso de ESTE mismo flujo. Con una espera de por medio sirve para insistir; sin ella, para juntar dos ramas en un solo final.',
    campos: [
      {
        key: 'paso',
        label: 'Paso destino',
        tipo: 'paso',
        requerido: true,
        ayuda: 'Sin destino, el contacto termina el flujo aquí.',
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

  // ── Equipos de ventas ──
  // Todos estos pasos trabajan sobre el LEAD del contacto en un equipo de ESTA
  // marca (`SalesLead.mktContactId`). Un contacto que no es lead de nadie —la
  // mayoría de una lista de correo— no tiene sobre qué crear una tarea ni una
  // oportunidad: el paso lo dice en el registro y el flujo sigue.
  {
    key: 'create_task',
    label: 'Crear tarea',
    grupo: 'Ventas',
    icono: '✅',
    hint: 'Una tarea del CRM del equipo, sobre el lead de este contacto. Aparece en «Tareas» del equipo.',
    campos: [
      {
        key: 'titulo',
        label: 'Acción',
        tipo: 'texto',
        requerido: true,
        ayuda: 'Un título corto, como en el CRM: «Llamar», «Seguimiento». Admite {{merge}}.',
      },
      { key: 'detalle', label: 'Qué hay que hacer', tipo: 'textarea', ayuda: 'El título solo no dice nada dentro de un mes. Admite {{merge}}.' },
      {
        key: 'asignarA',
        label: 'Para quién',
        tipo: 'select',
        def: '',
        opciones: [{ value: '', label: 'Quien lleva el lead' }],
        catalogo: 'miembros',
        ayuda: 'Si la persona elegida ya no está en el equipo del lead, la tarea queda para quien lo lleva.',
      },
      {
        key: 'vence',
        label: 'Vence en (días)',
        tipo: 'numero',
        def: 1,
        ayuda: 'Días desde hoy, en hora de Bogotá. 0 = hoy mismo.',
      },
    ],
    // Sin `{vence}` en la plantilla: «vence hoy» es un 0, y un 0 hace que el
    // resumen tire de los valores por defecto del catálogo y enseñe una tarjeta
    // que no dice lo que el paso hace (ver `aplicarPlantilla`).
    resumen: 'Tarea «{titulo}»',
  },
  {
    key: 'create_opportunity',
    label: 'Crear oportunidad',
    grupo: 'Ventas',
    icono: '💼',
    hint: 'Abre una oportunidad en el CRM del equipo del lead. Si ya tiene una ABIERTA en ese embudo, la MUEVE a la etapa elegida en vez de crear otra.',
    campos: [
      {
        key: 'embudo',
        label: 'Embudo',
        tipo: 'select',
        def: '',
        opciones: [{ value: '', label: 'El primero del equipo' }],
        catalogo: 'embudos',
        ayuda: 'Por nombre: la oportunidad nace en el embudo así llamado DEL EQUIPO DEL LEAD, no en el de otro equipo.',
      },
      {
        key: 'etapa',
        label: 'Etapa',
        tipo: 'select',
        def: '',
        opciones: [{ value: '', label: 'La primera del embudo' }],
        catalogo: 'etapas',
      },
      { key: 'nombre', label: 'Nombre de la oportunidad', tipo: 'texto', ayuda: 'Vacío = el nombre del lead. Admite {{merge}}.' },
      { key: 'valor', label: 'Valor', tipo: 'numero', def: 0 },
    ],
    resumen: 'Oportunidad en {embudo} · {etapa}',
  },
  {
    key: 'update_opportunity',
    label: 'Actualizar oportunidad',
    grupo: 'Ventas',
    icono: '📈',
    hint: 'Mueve de etapa, cambia el valor o cierra la oportunidad más reciente del lead. Si no tiene ninguna, no hace nada: para crearla está el paso de arriba.',
    campos: [
      {
        key: 'embudo',
        label: 'De este embudo',
        tipo: 'select',
        def: '',
        opciones: [{ value: '', label: 'Cualquiera (la más reciente)' }],
        catalogo: 'embudos',
      },
      {
        key: 'etapa',
        label: 'Moverla a',
        tipo: 'select',
        def: '',
        opciones: [{ value: '', label: 'Dejarla donde está' }],
        catalogo: 'etapas',
        ayuda: 'La etapa tiene que existir en el embudo de la oportunidad; si no, no se mueve (una etapa de otro embudo la dejaría fuera de todas las columnas).',
      },
      {
        key: 'estado',
        label: 'Dejarla como',
        tipo: 'select',
        def: '',
        opciones: [{ value: '', label: 'Sin cambiar' }, ...ESTADOS_DE_OPORTUNIDAD_DEL_FLUJO],
        ayuda: 'No se puede marcar «ganada» desde un flujo: ganar mueve el lead a clientes y registra la venta, y eso lo hace el CRM.',
      },
      { key: 'valor', label: 'Valor', tipo: 'texto', ayuda: 'Vacío = no se toca.' },
    ],
  },
  {
    key: 'meeting_confirm',
    label: 'Confirmar cita',
    grupo: 'Ventas',
    icono: '🟢',
    hint: 'Marca como confirmada la próxima cita viva del contacto. Es lo que se pone cuando el cliente contesta «ahí estaré»: el Banco del equipo la ve en verde.',
    campos: [],
  },
  {
    key: 'meeting_cancel',
    label: 'Cancelar cita',
    grupo: 'Ventas',
    icono: '🔴',
    hint: 'Cancela la próxima cita viva del contacto en la agenda del equipo. Una cita ya realizada o marcada como plantón NO se toca. OJO: el evento sigue en el Google Calendar del vendedor —avísale, o añade un paso «Crear tarea» para que lo borre él.',
    campos: [],
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
  {
    key: 'remove_from_workflows',
    label: 'Quitar de otros flujos',
    grupo: 'Salida',
    icono: '🚫',
    hint: 'Saca al contacto de las inscripciones que tenga en marcha. Es lo que se pone cuando alguien compra y hay que callar de golpe todas las secuencias de venta.',
    campos: [
      {
        key: 'modo',
        label: 'De cuáles',
        tipo: 'select',
        def: 'otros',
        opciones: [
          { value: 'otros', label: 'de todos menos de este' },
          { value: 'todos', label: 'de todos, incluido este' },
          { value: 'uno', label: 'de uno en concreto' },
        ],
      },
      { key: 'workflowId', label: 'Flujo del que sacarlo', tipo: 'flujo', ayuda: 'Solo se usa con «de uno en concreto».' },
    ],
    resumen: 'Quitar {modo}',
  },
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
  { key: 'campo', label: 'Dato que cambió' },
  { key: 'cita_estado', label: 'Estado de la cita' },
  { key: 'embudo', label: 'Embudo (CRM)' },
  { key: 'etapa_oportunidad', label: 'Etapa de la oportunidad' },
  { key: 'estado_oportunidad', label: 'Estado de la oportunidad' },
  { key: 'valor_oportunidad', label: 'Valor de la oportunidad' },
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
  // Solo traen valor cuando entró por el disparador que los pone. En los demás
  // quedan VACÍOS, nunca con un relleno inventado: un correo que dice «tu cita
  // del » es raro, pero uno que dice una fecha falsa hace perder una reunión.
  { key: 'cita_fecha', label: 'Fecha de la cita' },
  { key: 'cita_hora', label: 'Hora de la cita' },
  { key: 'cita_estado', label: 'Estado de la cita' },
  { key: 'embudo', label: 'Embudo (CRM)' },
  { key: 'etapa_oportunidad', label: 'Etapa de la oportunidad' },
  { key: 'estado_oportunidad', label: 'Estado de la oportunidad' },
  { key: 'valor_oportunidad', label: 'Valor de la oportunidad' },
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
  if (key === 'sales_meeting_status') {
    return {
      campos: [campoDe('cita_estado'), campoDe('equipo'), campoDe('vendedor'), ...CAMPOS_DEL_CONTACTO],
      operadores,
      nuevo: { field: 'cita_estado', op: 'eq' },
    };
  }
  if (key.startsWith('sales_opportunity_')) {
    return {
      campos: [
        campoDe('embudo'),
        campoDe('etapa_oportunidad'),
        campoDe('estado_oportunidad'),
        campoDe('valor_oportunidad'),
        campoDe('equipo'),
        campoDe('vendedor'),
        ...CAMPOS_DEL_CONTACTO,
      ],
      operadores,
      // Lo más útil de una oportunidad es cuánto vale: «mayor que X» separa la
      // secuencia del cliente grande de la del pequeño.
      nuevo: { field: 'valor_oportunidad', op: 'gt' },
    };
  }
  if (key === 'contact_updated') {
    return {
      campos: [campoDe('campo'), ...CAMPOS_DEL_CONTACTO],
      operadores,
      nuevo: { field: 'campo', op: 'contains' },
    };
  }
  return { campos: CAMPOS_DEL_CONTACTO, operadores, nuevo: { field: 'tags', op: 'has_tag' } };
}

/**
 * Las listas de la MARCA que completan los desplegables del catálogo: los
 * embudos, las etapas y los miembros de sus equipos de ventas.
 *
 * Van por NOMBRE y no por id a propósito. Una marca puede tener varios equipos,
 * cada uno con su copia de «Closers»; el flujo es de la marca, no de un equipo.
 * Guardando el nombre, el paso cae en el embudo así llamado DEL EQUIPO DEL
 * LEAD; guardando un id, todo el mundo acabaría en el tablero de un solo equipo
 * —o en ninguno—. Los miembros sí van por id: una persona es una persona.
 */
export type ListasDeLaMarca = {
  embudos: { value: string; label: string }[];
  etapas: { value: string; label: string }[];
  miembros: { value: string; label: string }[];
  /**
   * Las plantillas de correo que la marca puede usar en «Enviar correo»: las
   * suyas más las de fábrica. Van por ID —al revés que los embudos— porque una
   * plantilla SÍ es una fila concreta, y el paso guarda una referencia a ella
   * para leer su HTML del día en que se envíe.
   */
  plantillas: { value: string; label: string }[];
};

/**
 * Completa los desplegables que dependen de la marca. Devuelve copias: el
 * catálogo del módulo es una constante compartida entre peticiones y escribirle
 * las opciones de una marca se las enseñaría a la siguiente.
 */
function conListas<T extends { campos?: CampoDeConfig[] }>(items: T[], listas: ListasDeLaMarca | undefined): T[] {
  if (!listas) return items;
  return items.map((it) => {
    if (!it.campos?.some((c) => c.catalogo)) return it;
    return {
      ...it,
      campos: it.campos.map((c) =>
        c.catalogo ? { ...c, opciones: [...(c.opciones ?? []), ...listas[c.catalogo]] } : c,
      ),
    };
  });
}

/** Lo que la pantalla necesita para dibujarse entera. Una sola copia, esta. */
export function catalogoDeContactos(listas?: ListasDeLaMarca) {
  return {
    disparadores: conListas(MKT_TRIGGERS, listas).map((d) => ({ ...d, filtros: filtrosDelDisparador(d.key) })),
    pasos: conListas(MKT_NODE_TYPES, listas),
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

/**
 * Tope de saltos DENTRO del mismo flujo («Ir a un paso»).
 *
 * El tope de 60 nodos del motor no cubre esto: solo acota una pasada, y un «Ir
 * a» con una espera de por medio vuelve en la pasada siguiente. Sin este
 * contador, «espera un día y vuelve a intentarlo» es un flujo que escribe al
 * contacto todos los días para siempre.
 *
 * 50 y no 10: insistir durante un mes es un diseño legítimo; cincuenta vueltas
 * ya es un bucle que nadie quiso.
 */
export const MKT_MAX_SALTOS_DE_PASO = 50;

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
