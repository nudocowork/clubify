/**
 * Las reglas de la rejilla del día de la Agenda: qué franjas se pintan, en qué
 * celda cae cada cita y de qué color va.
 *
 * Puras a propósito —sin Prisma ni Nest— para probarlas contra este módulo y no
 * contra una copia. Las usa `SalesAgendaService.dia`.
 */

/**
 * Rango por defecto cuando el equipo no tiene horario ese día: el de TeamClubify
 * (`AGENDA_START_HOUR = 9`, `AGENDA_END_HOUR = 18`), última franja a las 17:30.
 */
export const INICIO_POR_DEFECTO = 9 * 60;
export const FIN_POR_DEFECTO = 18 * 60;
/** Bloques de 30 minutos, como la referencia. */
export const PASO = 30;

export type Semaforo = 'verde' | 'rojo' | 'gris';

const aHHMM = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const aMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** La hora de un instante en una zona, como «HH:MM». */
export function horaEnZona(d: Date, zona: string): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  let h = Number(partes.find((p) => p.type === 'hour')?.value ?? 0);
  // 'en-US' con hour12:false devuelve 24 a medianoche en vez de 0.
  if (h === 24) h = 0;
  const m = Number(partes.find((p) => p.type === 'minute')?.value ?? 0);
  return aHHMM(h * 60 + m);
}

/**
 * La franja en la que se pinta una cita: su hora redondeada hacia abajo al paso.
 * Una cita a las 10:45 va en la fila de las 10:30; si no, una cita fuera de un
 * múltiplo exacto de 30 minutos no aparecería en ninguna celda.
 */
export function franjaDeHora(hhmm: string, paso = PASO): string {
  const m = aMin(hhmm);
  return aHHMM(m - (m % paso));
}

/**
 * Las franjas del día.
 *
 * Salen del horario del equipo para ese día de la semana (de su primera hora a
 * la última); sin horario, el rango por defecto. Y se estiran con las citas que
 * caigan fuera: una cita agendada a las 19:00 tiene que verse aunque el equipo
 * «cierre» a las 18:00 — esconderla es perderla.
 */
export function franjasDelDia(
  horario: Array<{ startMin: number; endMin: number }>,
  horasDeCitas: string[],
  paso = PASO,
): string[] {
  const conRango = horario.filter((f) => f.endMin > f.startMin);
  const inicio = conRango.length
    ? Math.min(...conRango.map((f) => f.startMin))
    : INICIO_POR_DEFECTO;
  const fin = conRango.length ? Math.max(...conRango.map((f) => f.endMin)) : FIN_POR_DEFECTO;

  const franjas = new Set<string>();
  for (let m = inicio - (inicio % paso); m < fin; m += paso) franjas.add(aHHMM(m));
  for (const h of horasDeCitas) franjas.add(franjaDeHora(h, paso));
  return [...franjas].sort();
}

/**
 * El color de una cita en la rejilla. Es la regla de TeamClubify
 * (`appointmentColor` + `isConfirmed`):
 *
 * - Lo que ya PASÓ manda: realizada es verde aunque nadie confirmara antes;
 *   cancelada o no asistió es rojo aunque hubiera confirmado.
 * - Mientras está por delante, verde si confirmó por cualquier vía (a mano, por
 *   uno de los dos recordatorios o por el estado CONFIRMADA); si no, gris.
 *
 * Sin amarillo: TeamClubify lo usa para «reagendada», estado que Clubify PRO no
 * tiene.
 */
export function semaforoDeCita(c: {
  status: string;
  conf1h?: boolean | null;
  conf30min?: boolean | null;
  confirmedAt?: Date | null;
}): Semaforo {
  if (c.status === 'REALIZADA') return 'verde';
  if (c.status === 'CANCELADA' || c.status === 'NO_ASISTIO') return 'rojo';
  if (c.conf1h || c.conf30min || c.confirmedAt || c.status === 'CONFIRMADA') return 'verde';
  return 'gris';
}
