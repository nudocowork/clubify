/**
 * Pedidos agendados — ESPEJO de `backend/src/orders/pedidos-agendados.ts`.
 * Mantener sincronizado: `backend/src/orders/pedidos-agendados.spec.ts`
 * importa este archivo y compara las dos copias caso por caso.
 *
 * Vive también aquí por lo mismo que `horario-de-domicilios.mjs`: la respuesta
 * pública del negocio se cachea en el borde, así que las horas que se ofrecen
 * se calculan con el reloj del cliente y en la zona del negocio. El servidor
 * vuelve a validar al guardar: esta es la cara amable, no la autoridad.
 *
 * Reglas (ver la cabecera del backend): solo domicilio; cada 30 min dentro del
 * horario de domicilios; sin horario configurado, 08:00–20:00; el instante
 * viaja en UTC.
 */
import { aMinutos, enDoceHoras, franjasUtiles } from './horario-de-domicilios.mjs';

export const AGENDADO_POR_DEFECTO = { anticipacionHoras: 48, diasMaximos: 30 };
export const LIMITES_AGENDADO = {
  anticipacionMaxHoras: 30 * 24,
  diasMaximosMin: 1,
  diasMaximosMax: 90,
};
export const PASO_MIN = 30;
export const HORARIO_SIN_CONFIGURAR = [
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

function zonaSegura(zona) {
  if (!zona) return ZONA_POR_DEFECTO;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zona });
    return zona;
  } catch {
    return ZONA_POR_DEFECTO;
  }
}

const esEntero = (v) => typeof v === 'number' && Number.isInteger(v);

/** Tolerante: un valor raro vuelve al de por defecto. Ver el backend. */
export function leerAjustesAgendado(theme) {
  const raw = theme && typeof theme === 'object' ? theme.pedidosAgendados : null;
  const v = raw && typeof raw === 'object' ? raw : {};
  const ant =
    esEntero(v.anticipacionHoras) &&
    v.anticipacionHoras >= 0 &&
    v.anticipacionHoras <= LIMITES_AGENDADO.anticipacionMaxHoras
      ? v.anticipacionHoras
      : AGENDADO_POR_DEFECTO.anticipacionHoras;
  let max =
    esEntero(v.diasMaximos) &&
    v.diasMaximos >= LIMITES_AGENDADO.diasMaximosMin &&
    v.diasMaximos <= LIMITES_AGENDADO.diasMaximosMax
      ? v.diasMaximos
      : AGENDADO_POR_DEFECTO.diasMaximos;
  if (max * 24 <= ant) max = Math.min(LIMITES_AGENDADO.diasMaximosMax, Math.floor(ant / 24) + 1);
  return { activo: v.activo === true, anticipacionHoras: ant, diasMaximos: max };
}

/** Mismos mensajes que el backend, para avisar en el panel antes de guardar. */
export function validarAjustesAgendado(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return { ok: false, error: 'Los ajustes de pedidos agendados no son válidos.' };
  }
  if (typeof v.activo !== 'boolean') {
    return { ok: false, error: 'Indica si los pedidos agendados están encendidos o apagados.' };
  }
  const ant = v.anticipacionHoras ?? AGENDADO_POR_DEFECTO.anticipacionHoras;
  const max = v.diasMaximos ?? AGENDADO_POR_DEFECTO.diasMaximos;
  if (!esEntero(ant) || ant < 0 || ant > LIMITES_AGENDADO.anticipacionMaxHoras) {
    return { ok: false, error: 'La anticipación mínima va de 0 a 30 días.' };
  }
  if (!esEntero(max) || max < LIMITES_AGENDADO.diasMaximosMin || max > LIMITES_AGENDADO.diasMaximosMax) {
    return { ok: false, error: 'El máximo de días va de 1 a 90.' };
  }
  if (max * 24 <= ant) {
    return {
      ok: false,
      error:
        'El máximo de días tiene que ser mayor que la anticipación mínima: si no, no queda ninguna hora para agendar.',
    };
  }
  return { ok: true, ajustes: { activo: v.activo, anticipacionHoras: ant, diasMaximos: max } };
}

export function anticipacionEnPalabras(horas) {
  if (horas > 0 && horas % 24 === 0) {
    const d = horas / 24;
    return d === 1 ? '1 día' : `${d} días`;
  }
  return horas === 1 ? '1 hora' : `${horas} horas`;
}

function entregaA(franjas, diaSemana, minutos) {
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

function sumarDias(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function diaDeLaSemana(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** `YYYY-MM-DD` de un instante visto desde la zona. Espejo de `fechaEn`. */
export function fechaEn(d, zona) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaSegura(zona),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const val = (t) => partes.find((p) => p.type === t)?.value ?? '';
  return `${val('year')}-${val('month')}-${val('day')}`;
}

/**
 * (fecha local, minutos) en una zona → instante UTC. Espejo de
 * `minutosLocalesAUtc` (backend/src/common/franjas-horarias.ts): mide el
 * desfase REAL de ese día, así que vale con horario de verano.
 */
export function minutosLocalesAUtc(fecha, minutos, zona) {
  const [y, mo, d] = fecha.split('-').map(Number);
  const h = Math.floor(minutos / 60);
  const mi = minutos % 60;
  const comoUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zonaSegura(zona),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(comoUtc));
  const val = (t) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  let hora = val('hour');
  if (hora === 24) hora = 0;
  const proyectado = Date.UTC(val('year'), val('month') - 1, val('day'), hora, val('minute'), val('second'));
  return new Date(comoUtc - (proyectado - comoUtc));
}

function partesLocales(instante, zona) {
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
  const v = (t) => p.find((x) => x.type === t)?.value ?? '0';
  const fecha = `${v('year')}-${v('month')}-${v('day')}`;
  return {
    fecha,
    diaSemana: diaDeLaSemana(fecha),
    minutos: (Number(v('hour')) % 24) * 60 + Number(v('minute')),
    segundos: Number(v('second')),
  };
}

/**
 * Días y horas que se ofrecen. Ver `franjasDeAgendado` en el backend.
 * `horario` es lo que manda el público (`horarioDomicilios`): se limpia aquí
 * con `franjasUtiles`, que es lo que hace `estaAbierto`.
 */
export function franjasDeAgendado({ horario, zona, anticipacionHoras, diasMaximos, ahora }) {
  const z = zonaSegura(zona);
  const franjas = franjasUtiles(horario);
  const desde = ahora.getTime() + anticipacionHoras * 3_600_000;
  const hasta = ahora.getTime() + diasMaximos * 86_400_000;
  if (!(hasta > desde)) return [];
  const primera = fechaEn(new Date(desde), z);
  const ultima = fechaEn(new Date(hasta), z);
  const dias = [];
  for (let fecha = primera, n = 0; fecha <= ultima && n < 130; fecha = sumarDias(fecha, 1), n++) {
    const diaSemana = diaDeLaSemana(fecha);
    const horas = [];
    const vistos = new Set();
    for (let m = 0; m < 24 * 60; m += PASO_MIN) {
      if (!entregaA(franjas, diaSemana, m)) continue;
      const t = minutosLocalesAUtc(fecha, m, z);
      if (vistos.has(t.getTime())) continue;
      vistos.add(t.getTime());
      horas.push({
        minutos: m,
        instante: t.toISOString(),
        disponible: t.getTime() >= desde && t.getTime() > ahora.getTime() && t.getTime() <= hasta,
      });
    }
    dias.push({ fecha, diaSemana, horas, disponible: horas.some((h) => h.disponible) });
  }
  return dias;
}

export const MARGEN_ANTICIPACION_MS = 5 * 60_000;

/** Espejo de la validación del servidor (que es la que manda). */
export function validarAgendado({ instante, horario, zona, anticipacionHoras, diasMaximos, ahora }) {
  const z = zonaSegura(zona);
  const t = instante instanceof Date ? instante : new Date(String(instante ?? ''));
  if (Number.isNaN(t.getTime())) {
    return { ok: false, error: 'La fecha de entrega no es válida. Elige de nuevo el día y la hora.' };
  }
  const a = ahora.getTime();
  if (t.getTime() <= a) {
    return { ok: false, error: 'Esa hora ya pasó. Elige otro día u otra hora para tu pedido.' };
  }
  if (t.getTime() < a + anticipacionHoras * 3_600_000 - MARGEN_ANTICIPACION_MS) {
    return {
      ok: false,
      error: `Este negocio pide al menos ${anticipacionEnPalabras(anticipacionHoras)} de anticipación para los pedidos agendados. Elige una hora más adelante.`,
    };
  }
  if (t.getTime() > a + diasMaximos * 86_400_000) {
    return {
      ok: false,
      error: `Este negocio recibe pedidos agendados hasta ${diasMaximos} ${diasMaximos === 1 ? 'día' : 'días'} adelante. Elige una fecha más cercana.`,
    };
  }
  const p = partesLocales(t, z);
  if (p.segundos !== 0 || t.getUTCMilliseconds() !== 0 || p.minutos % PASO_MIN !== 0) {
    return { ok: false, error: 'Elige una de las horas que ofrece el menú.' };
  }
  if (!entregaA(franjasUtiles(horario), p.diaSemana, p.minutos)) {
    return { ok: false, error: 'A esa hora el negocio no entrega domicilios. Elige otra hora.' };
  }
  return { ok: true, instante: t };
}

/** «vie 10 oct · 7:30 p. m.» / «viernes 10 de octubre · 7:30 p. m.». Ver backend. */
export function describirAgendado(instante, zona) {
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

/** Rango [desde, hasta) de cada filtro del panel, en la zona del negocio. */
export function rangoDelFiltro(filtro, ahora, zona) {
  const z = zonaSegura(zona);
  const hoy = fechaEn(ahora, z);
  const inicio = (f) => minutosLocalesAUtc(f, 0, z);
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

/** ¿Cae ese instante en el día de HOY del negocio? Para la etiqueta del tablero. */
export function esHoyEn(instante, ahora, zona) {
  const t = instante instanceof Date ? instante : new Date(instante);
  return fechaEn(t, zona) === fechaEn(ahora, zona);
}

/**
 * Id de un intento de compra, para que el servidor no cree dos pedidos si el
 * mismo checkout se envía dos veces (doble toque, reintento tras un corte).
 * `crypto.randomUUID` no existe en navegadores viejos ni fuera de HTTPS.
 */
export function nuevoIdDeIntento() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* cae al de abajo */
  }
  const hex = (n) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}
