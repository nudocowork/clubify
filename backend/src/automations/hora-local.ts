/**
 * Hora y fecha LOCALES de un negocio, a partir de su `Tenant.timezone`.
 *
 * EL BUG QUE ESTO ARREGLA (reportado por Javier, 16-09-2026): «hoy llegó una
 * push Android a las 4am, lo cual no tiene sentido».
 *
 * Los crons diarios de automatizaciones estaban clavados a una hora **UTC**
 * (`@Cron('0 8 * * *')` para cumpleaños, `@Cron('0 9 * * *')` para inactividad)
 * y el servidor de Railway va en UTC (el Dockerfile no fija `TZ`). Para un
 * negocio de Bogotá (UTC-5) eso es las **3am** y las **4am** de su hora local.
 * No era un caso raro: en producción, en 60 días, 482 push salieron a las 3am
 * y 1.027 a las 4am — todas de automatizaciones, ninguna a otra hora rara.
 *
 * `Tenant.timezone` ya existe (default 'America/Bogota') y nadie lo miraba.
 * Y hay negocios fuera de Colombia: 8 en America/New_York, 5 en America/Caracas,
 * 5 en America/Mexico_City, 4 en America/Lima, 3 en America/Santiago, y uno en
 * cada una de Tegucigalpa, Puerto_Rico, La_Paz y Guatemala. Una hora UTC fija
 * no puede ser «las 8 de la mañana» para todos a la vez.
 *
 * Son funciones puras a propósito: la aritmética de zonas horarias es donde se
 * cuelan los errores de un día o de una hora, y así se puede probar sola.
 */
import { Logger } from '@nestjs/common';

/** A lo que se cae una zona horaria que Intl no reconozca. */
const ZONA_POR_DEFECTO = 'America/Bogota';

const log = new Logger('hora-local');
/** Zonas por las que ya se avisó. Sin esto el aviso saldría cada hora. */
const yaAvisadas = new Set<string>();

/**
 * Una zona que `Intl` sepa interpretar. Un valor corrupto en la base no puede
 * tumbar el cron de TODOS los negocios, así que se cae al default — pero se
 * AVISA: si no, un negocio con la columna mal recibe sus mensajes en hora de
 * Bogotá para siempre y nadie se entera. Una vez por zona, no una por pasada.
 */
function zonaSegura(zona: string | null | undefined): string {
  if (!zona) {
    if (!yaAvisadas.has('(vacía)')) {
      yaAvisadas.add('(vacía)');
      log.warn(`Negocio sin timezone — se usa ${ZONA_POR_DEFECTO}`);
    }
    return ZONA_POR_DEFECTO;
  }
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zona });
    return zona;
  } catch {
    if (!yaAvisadas.has(zona)) {
      yaAvisadas.add(zona);
      log.warn(`Timezone inválida "${zona}" — se usa ${ZONA_POR_DEFECTO}`);
    }
    return ZONA_POR_DEFECTO;
  }
}

function partes(ahora: Date, zona: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaSegura(zona),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const p = fmt.formatToParts(ahora);
  const buscar = (tipo: string) => p.find((x) => x.type === tipo)?.value ?? '';
  return {
    year: buscar('year'),
    month: buscar('month'),
    day: buscar('day'),
    // 'en-CA' con hour12:false devuelve '24' para la medianoche en algunos
    // runtimes de Node; para nosotros la medianoche es la hora 0.
    hour: Number(buscar('hour')) % 24,
    minute: Number(buscar('minute')) || 0,
    weekday: buscar('weekday'),
  };
}

/** Domingo=0 … Sábado=6, igual que `Date.getDay()`. */
const DIAS: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * En qué momento de la semana está AHORA ese negocio: qué día y cuántos
 * minutos lleva del día.
 *
 * Hace falta el minuto, y no solo la hora, para los horarios de domicilio: una
 * hamburguesería que abre a las 18:30 no abre a las 18:00.
 */
export function momentoLocal(
  ahora: Date,
  zona: string,
): { diaSemana: number; minutos: number } {
  const p = partes(ahora, zona);
  return {
    diaSemana: DIAS[p.weekday] ?? 0,
    minutos: p.hour * 60 + p.minute,
  };
}

/** Qué hora (0-23) es AHORA en ese negocio. */
export function horaLocal(ahora: Date, zona: string): number {
  return partes(ahora, zona).hour;
}

/** Qué día es HOY en ese negocio, como 'YYYY-MM-DD'. */
export function fechaLocal(ahora: Date, zona: string): string {
  const { year, month, day } = partes(ahora, zona);
  return `${year}-${month}-${day}`;
}

/**
 * Resta días a una fecha 'YYYY-MM-DD'.
 *
 * Se hace en UTC a propósito: la fecha ya viene resuelta en la zona del
 * negocio, así que aquí es una cuenta de calendario y meterle otra zona
 * encima es justo como se producen los errores de un día de desfase.
 */
export function restarDias(fechaISO: string, dias: number): string {
  const base = new Date(`${fechaISO}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - dias);
  return base.toISOString().slice(0, 10);
}
