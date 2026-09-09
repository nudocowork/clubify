/**
 * Convertir entre «las 9 de la mañana en Bogotá» y un instante UTC, y sacar
 * las franjas libres de un día.
 *
 * Es el mismo algoritmo que usan las reservas de servicios desde hace meses.
 * Se copia aquí en vez de importarlo por una razón concreta:
 * `service-reservations.service.ts` son 1.057 líneas **sin una sola prueba**, y
 * mueve citas de negocios reales. Sacarle las funciones de dentro sin red
 * debajo no compensa hoy.
 *
 * Esta copia SÍ tiene pruebas. El día que alguien quiera unificarlas, el
 * trabajo es borrar las privadas de aquel fichero y apuntar aquí — y ya hay
 * quien avise si el cambio rompe algo.
 *
 * POR QUÉ NO VALE `new Date('2026-09-08T09:00:00')`
 * -------------------------------------------------
 * Esa forma usa la zona del SERVIDOR, que en Railway es UTC. «Las 9» acabarían
 * siendo las 4 de la mañana en Bogotá. Y sumar cinco horas a mano tampoco
 * vale: hay zonas con horario de verano, y dos veces al año el desfase cambia.
 * La única forma correcta es preguntarle a `Intl` cuánto vale el desfase EN ESE
 * INSTANTE, que es lo que hace `minutosLocalesAUtc`.
 */

/** Un tramo del día, en minutos desde medianoche. 540–1080 = 9:00 a 18:00. */
export interface Franja {
  startMin: number;
  endMin: number;
}

/** Una cita ya ocupada. */
export interface Ocupado {
  startAt: Date;
  endAt: Date;
}

export interface Hueco {
  startAt: Date;
  /** "09:30", para pintar el botón sin recalcular nada. */
  label: string;
}

/**
 * (fecha `YYYY-MM-DD`, minutos desde medianoche) en una zona → instante UTC.
 *
 * A prueba de horario de verano: proyecta el instante candidato a la zona, mide
 * el desfase REAL de ese día y lo descuenta.
 */
export function minutosLocalesAUtc(
  fecha: string,
  minutos: number,
  zona: string,
): Date {
  const [y, mo, d] = fecha.split('-').map(Number);
  const h = Math.floor(minutos / 60);
  const mi = minutos % 60;
  const comoUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(comoUtc));
  const val = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  // 'en-US' con hour12:false devuelve 24 a medianoche en vez de 0.
  let hora = val('hour');
  if (hora === 24) hora = 0;
  const proyectado = Date.UTC(
    val('year'),
    val('month') - 1,
    val('day'),
    hora,
    val('minute'),
    val('second'),
  );
  return new Date(comoUtc - (proyectado - comoUtc));
}

/** Día de la semana (0 = domingo) de una fecha `YYYY-MM-DD` en esa zona. */
export function diaDeLaSemanaEn(fecha: string, zona: string): number {
  const [y, mo, d] = fecha.split('-').map(Number);
  // Mediodía y no medianoche: a las 00:00 UTC, media América sigue en el día
  // anterior y el día de la semana saldría corrido.
  const mediodia = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  const corto = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    weekday: 'short',
  }).format(mediodia);
  const mapa: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return mapa[corto] ?? 0;
}

/** `YYYY-MM-DD` de un instante, visto desde esa zona. */
export function fechaEn(d: Date, zona: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const val = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${val('year')}-${val('month')}-${val('day')}`;
}

/** 570 → "09:30". */
export function etiquetaDeMinutos(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function fechaValida(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, mo, d] = s.split('-').map(Number);
  // `2026-02-31` pasa el patrón y no existe. `Date.UTC` lo desborda a marzo, y
  // comparar de vuelta lo delata.
  const t = new Date(Date.UTC(y, mo - 1, d));
  return (
    t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
  );
}

/**
 * Los huecos libres de un día.
 *
 * Recorre cada franja de paso en paso, descarta lo que ya pasó y lo que pisa
 * una cita. El solape se mide `inicio < finOcupado && fin > inicioOcupado`:
 * una cita que TERMINA justo cuando empieza el hueco no estorba, y eso es lo
 * que permite encadenar citas seguidas.
 */
export function huecosDelDia(entrada: {
  fecha: string;
  zona: string;
  franjas: Franja[];
  ocupado: Ocupado[];
  duracionMin: number;
  /** Cada cuánto se ofrece un hueco. 15 min por defecto. */
  pasoMin?: number;
  /** Instante "ahora", para no ofrecer huecos que ya pasaron. */
  ahora?: Date;
  /** Minutos de aviso mínimo: no ofrecer algo dentro de 2 minutos. */
  antelacionMin?: number;
}): Hueco[] {
  const {
    fecha,
    zona,
    franjas,
    ocupado,
    duracionMin,
    pasoMin = 15,
    ahora = new Date(),
    antelacionMin = 0,
  } = entrada;

  if (!fechaValida(fecha)) return [];
  if (!Number.isFinite(duracionMin) || duracionMin <= 0) return [];
  if (!Number.isFinite(pasoMin) || pasoMin <= 0) return [];

  const noAntesDe = ahora.getTime() + antelacionMin * 60_000;
  const huecos: Hueco[] = [];
  const vistos = new Set<number>();

  for (const f of franjas) {
    if (!Number.isFinite(f.startMin) || !Number.isFinite(f.endMin)) continue;
    for (let m = f.startMin; m + duracionMin <= f.endMin; m += pasoMin) {
      const inicio = minutosLocalesAUtc(fecha, m, zona);
      const fin = new Date(inicio.getTime() + duracionMin * 60_000);
      if (inicio.getTime() < noAntesDe) continue;
      if (ocupado.some((o) => inicio < o.endAt && fin > o.startAt)) continue;
      // Dos franjas que se solapan darían el mismo hueco dos veces.
      if (vistos.has(inicio.getTime())) continue;
      vistos.add(inicio.getTime());
      huecos.push({ startAt: inicio, label: etiquetaDeMinutos(m) });
    }
  }
  return huecos.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/** Lo que no se puede guardar como franja, o `null` si está bien. */
export function errorDeFranja(f: Partial<Franja>): string | null {
  const { startMin, endMin } = f;
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin)) {
    return 'Las horas tienen que ser minutos enteros desde medianoche.';
  }
  if (startMin! < 0 || endMin! > 24 * 60) {
    return 'El horario tiene que caber dentro del día.';
  }
  if (endMin! <= startMin!) {
    return 'La hora de fin tiene que ser posterior a la de inicio.';
  }
  return null;
}
