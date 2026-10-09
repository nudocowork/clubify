/**
 * PEDIDOS AGENDADOS: el cliente pide hoy un domicilio para otro día y hora.
 *
 * EL CASO (Javier, 2026-10-09): un negocio quiere recibir pedidos con fecha
 * —una torta para el viernes, el almuerzo de una oficina para el lunes— y,
 * sobre todo, dejar de perder al cliente que llega cuando está CERRADO: hoy el
 * checkout se bloquea con «no estamos recibiendo domicilios» y el cliente se
 * va. Con esto, cerrado y con la función encendida, se le ofrece agendar.
 *
 * Reglas aprobadas:
 *  - Solo DOMICILIO. Para llevar y mesa no se agendan.
 *  - Ajustes POR NEGOCIO en `Storefront.theme.pedidosAgendados`
 *    (`{ activo, anticipacionHoras, diasMaximos }`), sin migración. Por
 *    defecto 48 h de anticipación y 30 días de máximo.
 *  - Las horas que se ofrecen son de media en media hora DENTRO del horario
 *    de domicilios (`Tenant.deliveryHours`). Un negocio SIN horario recibe
 *    pedidos a cualquier hora para lo inmediato, pero para agendar se le
 *    ofrece 08:00–20:00: ofrecer las 3 de la mañana a un negocio que nunca dijo
 *    que abre a esa hora sería prometer una entrega que nadie va a hacer.
 *  - El instante se guarda en UTC; se calcula y se muestra en la zona del
 *    negocio (`Tenant.timezone`), nunca en la del servidor (UTC) ni en la del
 *    visitante.
 *
 * ESPEJO en `frontend/src/lib/pedidos-agendados.mjs`, igual que
 * `horario-de-domicilios`: el menú público se cachea minutos en el borde, así
 * que el cliente calcula las franjas con su propio reloj, y el servidor vuelve
 * a validar con el suyo al guardar. Si cambias una regla aquí, cámbiala allí:
 * `pedidos-agendados.spec.ts` compara las dos copias caso por caso.
 *
 * Módulo puro (sin Nest, sin Prisma) para poder probar la aritmética de
 * medianoche y de zonas horarias, que es donde se cuelan los errores de un
 * día o de una hora.
 */
import { aMinutos, enDoceHoras, type Franja } from './horario-de-domicilios';
import { fechaEn, minutosLocalesAUtc } from '../common/franjas-horarias';

export type AjustesAgendado = {
  activo: boolean;
  /** Horas mínimas entre «ahora» y la entrega. 0 = desde la próxima media hora. */
  anticipacionHoras: number;
  /** Hasta cuántos días adelante se puede agendar. */
  diasMaximos: number;
};

export const AGENDADO_POR_DEFECTO = { anticipacionHoras: 48, diasMaximos: 30 };

/** Rangos que el panel deja guardar. Más allá deja de ser «agendar» y pasa a ser un error de dedo. */
export const LIMITES_AGENDADO = {
  anticipacionMaxHoras: 30 * 24,
  diasMaximosMin: 1,
  diasMaximosMax: 90,
};

/** Cada cuánto se ofrece una hora. */
export const PASO_MIN = 30;

/** Lo que se ofrece a un negocio que nunca configuró horario. Ver cabecera. */
export const HORARIO_SIN_CONFIGURAR: Franja[] = [
  { dias: [0, 1, 2, 3, 4, 5, 6], desde: '08:00', hasta: '20:00' },
];

const ZONA_POR_DEFECTO = 'America/Bogota';

const DIA_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DIA_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const MES_LARGO = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function zonaSegura(zona: string | null | undefined): string {
  if (!zona) return ZONA_POR_DEFECTO;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zona });
    return zona;
  } catch {
    return ZONA_POR_DEFECTO;
  }
}

const esEntero = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Lee los ajustes tal como están guardados en `theme`.
 *
 * Tolerante a propósito, como `leerHorario`: lo que entra se valida con
 * `validarAjustesAgendado`, pero al LEER una fila rara no puede tumbar el
 * checkout. Un número fuera de rango vuelve al valor por defecto.
 */
export function leerAjustesAgendado(theme: unknown): AjustesAgendado {
  const raw =
    theme && typeof theme === 'object'
      ? (theme as Record<string, unknown>).pedidosAgendados
      : null;
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const ant = esEntero(v.anticipacionHoras) &&
    v.anticipacionHoras >= 0 &&
    v.anticipacionHoras <= LIMITES_AGENDADO.anticipacionMaxHoras
    ? v.anticipacionHoras
    : AGENDADO_POR_DEFECTO.anticipacionHoras;
  let max = esEntero(v.diasMaximos) &&
    v.diasMaximos >= LIMITES_AGENDADO.diasMaximosMin &&
    v.diasMaximos <= LIMITES_AGENDADO.diasMaximosMax
    ? v.diasMaximos
    : AGENDADO_POR_DEFECTO.diasMaximos;
  // Un máximo que no supera la anticipación no deja ninguna hora libre: el
  // cliente vería el selector vacío. Mejor ensanchar que dejarlo sin salida.
  if (max * 24 <= ant) max = Math.min(LIMITES_AGENDADO.diasMaximosMax, Math.floor(ant / 24) + 1);
  return { activo: v.activo === true, anticipacionHoras: ant, diasMaximos: max };
}

/** Valida lo que manda el panel. Mensajes en español y diciendo qué corregir. */
export function validarAjustesAgendado(
  v: unknown,
): { ok: true; ajustes: AjustesAgendado } | { ok: false; error: string } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return { ok: false, error: 'Los ajustes de pedidos agendados no son válidos.' };
  }
  const o = v as Record<string, unknown>;
  if (typeof o.activo !== 'boolean') {
    return { ok: false, error: 'Indica si los pedidos agendados están encendidos o apagados.' };
  }
  const ant = o.anticipacionHoras ?? AGENDADO_POR_DEFECTO.anticipacionHoras;
  const max = o.diasMaximos ?? AGENDADO_POR_DEFECTO.diasMaximos;
  if (!esEntero(ant) || ant < 0 || ant > LIMITES_AGENDADO.anticipacionMaxHoras) {
    return { ok: false, error: 'La anticipación mínima va de 0 a 30 días.' };
  }
  if (!esEntero(max) || max < LIMITES_AGENDADO.diasMaximosMin || max > LIMITES_AGENDADO.diasMaximosMax) {
    return { ok: false, error: 'El máximo de días va de 1 a 90.' };
  }
  if (max * 24 <= ant) {
    return {
      ok: false,
      error: 'El máximo de días tiene que ser mayor que la anticipación mínima: si no, no queda ninguna hora para agendar.',
    };
  }
  return { ok: true, ajustes: { activo: o.activo, anticipacionHoras: ant, diasMaximos: max } };
}

/** «2 días», «1 día», «5 horas», «1 hora». Para mensajes al cliente. */
export function anticipacionEnPalabras(horas: number): string {
  if (horas > 0 && horas % 24 === 0) {
    const d = horas / 24;
    return d === 1 ? '1 día' : `${d} días`;
  }
  return horas === 1 ? '1 hora' : `${horas} horas`;
}

/**
 * ¿Entrega el negocio en ese minuto de ese día de la semana?
 *
 * La misma regla que `estaAbierto`: una franja que cruza la medianoche es del
 * día en que EMPIEZA, y su tramo de después de medianoche cuenta para el día
 * siguiente. Sin franjas útiles, `HORARIO_SIN_CONFIGURAR`.
 */
function entregaA(franjas: Franja[], diaSemana: number, minutos: number): boolean {
  const lista = franjas.length ? franjas : HORARIO_SIN_CONFIGURAR;
  const ayer = (diaSemana + 6) % 7;
  return lista.some((f) => {
    const desde = aMinutos(f.desde);
    const hasta = aMinutos(f.hasta);
    if (desde === null || hasta === null || desde === hasta) return false;
    if (desde < hasta) return f.dias.includes(diaSemana) && minutos >= desde && minutos < hasta;
    return (f.dias.includes(diaSemana) && minutos >= desde) || (f.dias.includes(ayer) && minutos < hasta);
  });
}

/** Fecha `YYYY-MM-DD` + n días, como cuenta de calendario (en UTC a propósito). */
function sumarDias(fecha: string, n: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Día de la semana de una fecha de calendario. Sin zona: la fecha ya es local. */
function diaDeLaSemana(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Día y minuto LOCALES de un instante, en la zona del negocio. */
function partesLocales(instante: Date, zona: string) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instante);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '0';
  const fecha = `${v('year')}-${v('month')}-${v('day')}`;
  return {
    fecha,
    diaSemana: diaDeLaSemana(fecha),
    // Algunos runtimes devuelven «24» a medianoche con hour12:false.
    minutos: (Number(v('hour')) % 24) * 60 + Number(v('minute')),
    segundos: Number(v('second')),
  };
}

export type HoraAgendable = {
  /** Minutos desde la medianoche LOCAL del día. 1170 = 7:30 p. m. */
  minutos: number;
  /** El instante, en ISO UTC: lo que viaja al servidor. */
  instante: string;
  disponible: boolean;
};

export type DiaAgendable = {
  /** `YYYY-MM-DD` en la zona del negocio. */
  fecha: string;
  diaSemana: number;
  horas: HoraAgendable[];
  /** Hay al menos una hora disponible. */
  disponible: boolean;
};

/**
 * Los días y horas que se le ofrecen al cliente.
 *
 * Días: desde el primero en que la anticipación deja alguna hora hasta el
 * último que permite el máximo. Un día sin horario (cerrado los lunes) sale
 * igual, deshabilitado: ver el hueco explica por qué no se puede, esconderlo
 * hace pensar que el selector está roto.
 *
 * Horas: las de media en media hora dentro del horario de ese día. Disponibles
 * las que caen entre «ahora + anticipación» y «ahora + máximo».
 */
export function franjasDeAgendado(entrada: {
  horario: Franja[] | null | undefined;
  zona: string | null | undefined;
  anticipacionHoras: number;
  diasMaximos: number;
  ahora: Date;
}): DiaAgendable[] {
  const zona = zonaSegura(entrada.zona);
  const franjas = entrada.horario ?? [];
  const desde = entrada.ahora.getTime() + entrada.anticipacionHoras * 3_600_000;
  const hasta = entrada.ahora.getTime() + entrada.diasMaximos * 86_400_000;
  if (!(hasta > desde)) return [];
  const primera = fechaEn(new Date(desde), zona);
  const ultima = fechaEn(new Date(hasta), zona);
  const dias: DiaAgendable[] = [];
  // Tope de seguridad: 90 días de máximo + 30 de anticipación.
  for (let fecha = primera, n = 0; fecha <= ultima && n < 130; fecha = sumarDias(fecha, 1), n++) {
    const diaSemana = diaDeLaSemana(fecha);
    const horas: HoraAgendable[] = [];
    const vistos = new Set<number>();
    for (let m = 0; m < 24 * 60; m += PASO_MIN) {
      if (!entregaA(franjas, diaSemana, m)) continue;
      const t = minutosLocalesAUtc(fecha, m, zona);
      // El día que se adelanta el reloj, la hora que «no existe» cae sobre
      // otra: no se ofrece dos veces el mismo instante.
      if (vistos.has(t.getTime())) continue;
      vistos.add(t.getTime());
      horas.push({
        minutos: m,
        instante: t.toISOString(),
        // `> ahora` además de `>= desde`: con anticipación 0, la hora en punto
        // que acaba de empezar ya no es «después».
        disponible:
          t.getTime() >= desde && t.getTime() > entrada.ahora.getTime() && t.getTime() <= hasta,
      });
    }
    dias.push({ fecha, diaSemana, horas, disponible: horas.some((h) => h.disponible) });
  }
  return dias;
}

/**
 * Margen al validar la anticipación en el servidor. El cliente eligió la hora
 * con su reloj al empezar a rellenar; si tardó un par de minutos, rechazarle la
 * primera hora libre por eso sería castigarlo por leer despacio. La regla del
 * negocio es de comodidad, no de segundos.
 */
export const MARGEN_ANTICIPACION_MS = 5 * 60_000;

/**
 * ¿Se puede guardar un pedido agendado para ese instante?
 *
 * Es la autoridad: el selector del cliente solo ofrece lo válido, pero un POST
 * directo —o una página abierta desde hace horas— puede mandar cualquier cosa.
 */
export function validarAgendado(entrada: {
  instante: string | Date;
  horario: Franja[] | null | undefined;
  zona: string | null | undefined;
  anticipacionHoras: number;
  diasMaximos: number;
  ahora: Date;
}): { ok: true; instante: Date } | { ok: false; error: string } {
  const zona = zonaSegura(entrada.zona);
  const t = entrada.instante instanceof Date ? entrada.instante : new Date(String(entrada.instante ?? ''));
  if (Number.isNaN(t.getTime())) {
    return { ok: false, error: 'La fecha de entrega no es válida. Elige de nuevo el día y la hora.' };
  }
  const ahora = entrada.ahora.getTime();
  if (t.getTime() <= ahora) {
    return { ok: false, error: 'Esa hora ya pasó. Elige otro día u otra hora para tu pedido.' };
  }
  if (t.getTime() < ahora + entrada.anticipacionHoras * 3_600_000 - MARGEN_ANTICIPACION_MS) {
    return {
      ok: false,
      error: `Este negocio pide al menos ${anticipacionEnPalabras(entrada.anticipacionHoras)} de anticipación para los pedidos agendados. Elige una hora más adelante.`,
    };
  }
  if (t.getTime() > ahora + entrada.diasMaximos * 86_400_000) {
    return {
      ok: false,
      error: `Este negocio recibe pedidos agendados hasta ${entrada.diasMaximos} ${entrada.diasMaximos === 1 ? 'día' : 'días'} adelante. Elige una fecha más cercana.`,
    };
  }
  const p = partesLocales(t, zona);
  // Solo las horas del selector: en punto o y media, sin segundos. Una hora
  // suelta (las 7:13) no la ofrece nadie, así que viene de fuera del checkout.
  if (p.segundos !== 0 || t.getUTCMilliseconds() !== 0 || p.minutos % PASO_MIN !== 0) {
    return { ok: false, error: 'Elige una de las horas que ofrece el menú.' };
  }
  if (!entregaA(entrada.horario ?? [], p.diaSemana, p.minutos)) {
    return { ok: false, error: 'A esa hora el negocio no entrega domicilios. Elige otra hora.' };
  }
  return { ok: true, instante: t };
}

/**
 * La fecha y hora de un pedido agendado en palabras, en la zona del negocio.
 *
 *   corto: «vie 10 oct · 7:30 p. m.»   (aviso al negocio, panel)
 *   largo: «viernes 10 de octubre · 7:30 p. m.»   (WhatsApp, confirmación)
 *   hora:  «7:30 p. m.»
 *
 * Con nombres propios y no con `Intl` en español: el formato de `Intl` cambia
 * entre versiones de ICU («vie.», «p. m.» con espacio duro…) y este texto va
 * en SMS, donde un carácter raro cambia la codificación del mensaje entero.
 */
export function describirAgendado(
  instante: Date | string,
  zona: string | null | undefined,
): { corto: string; largo: string; hora: string; fecha: string } {
  const t = instante instanceof Date ? instante : new Date(instante);
  const p = partesLocales(t, zonaSegura(zona));
  const [, mes, dia] = p.fecha.split('-').map(Number);
  const hora = enDoceHoras(p.minutos);
  return {
    corto: `${DIA_CORTO[p.diaSemana]} ${dia} ${MES_CORTO[mes - 1]} · ${hora}`,
    largo: `${DIA_LARGO[p.diaSemana]} ${dia} de ${MES_LARGO[mes - 1]} · ${hora}`,
    hora,
    fecha: p.fecha,
  };
}

/** Filtros de la vista «Pedidos agendados» del panel. */
export type FiltroAgendados = 'hoy' | 'manana' | 'semana' | 'todos';

/**
 * El rango [desde, hasta) de cada filtro, en la zona del negocio.
 *
 * «Hoy» es el día local entero —también lo que ya pasó hoy y sigue sin
 * entregar—, porque es justo lo que hay que mirar. «Todos» es desde el
 * comienzo de hoy, sin tope.
 */
export function rangoDelFiltro(
  filtro: FiltroAgendados,
  ahora: Date,
  zona: string | null | undefined,
): { desde: Date; hasta: Date | null } {
  const z = zonaSegura(zona);
  const hoy = fechaEn(ahora, z);
  const inicio = (f: string) => minutosLocalesAUtc(f, 0, z);
  switch (filtro) {
    case 'hoy':
      return { desde: inicio(hoy), hasta: inicio(sumarDias(hoy, 1)) };
    case 'manana':
      return { desde: inicio(sumarDias(hoy, 1)), hasta: inicio(sumarDias(hoy, 2)) };
    case 'semana':
      return { desde: inicio(hoy), hasta: inicio(sumarDias(hoy, 7)) };
    default:
      return { desde: inicio(hoy), hasta: null };
  }
}

/** Formato que acepta el servidor para `clientRequestId`: un uuid o parecido. */
export const ES_ID_DE_INTENTO = /^[A-Za-z0-9-]{8,64}$/;
