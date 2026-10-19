/**
 * Rangos de fecha de /admin/metricas, en días de BOGOTÁ.
 *
 * Por qué hora Bogotá y no la del servidor: el servidor corre en UTC (ver
 * memoria «crons en UTC») y un pase emitido a las 8 p. m. en Colombia ya es
 * «mañana» en UTC. Si los días se cortaran en UTC, la gráfica de «hoy» se
 * vaciaría a las 7 p. m. y cada barra mezclaría dos noches.
 *
 * Colombia no tiene horario de verano: el desfase es SIEMPRE −5 h, así que
 * basta un desplazamiento fijo (sin librería de zonas). La medianoche de un
 * día de Bogotá es las 05:00 UTC de ese mismo día.
 *
 * Todo aquí es puro (recibe `ahora`) para poder probarlo sin reloj ni base.
 */

export const ZONA = 'America/Bogota';
const DESFASE_MS = 5 * 3_600_000;
const DIA_MS = 86_400_000;

/** Más allá de esto la consulta deja de ser «un rango» y pasa a ser el histórico. */
export const MAX_DIAS_RANGO = 731;
/** Hasta 62 días se dibuja por día; más largo, por semana (si no, 90 barras ilegibles). */
export const MAX_DIAS_POR_DIA = 62;

export const PRESETS = ['hoy', '7d', '30d', '90d', 'mes', 'mesAnterior', 'personalizado'] as const;
export type Preset = (typeof PRESETS)[number];

/** Rango de días de Bogotá, AMBOS inclusive, como `AAAA-MM-DD`. */
export interface Rango {
  desde: string;
  hasta: string;
}

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

function partes(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y, m, d];
}

function aYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Medianoche UTC del día `ymd` (solo para aritmética de días, no es Bogotá). */
function msDia(ymd: string): number {
  const [y, m, d] = partes(ymd);
  return Date.UTC(y, m - 1, d);
}

export function esDiaValido(ymd: unknown): ymd is string {
  if (typeof ymd !== 'string' || !RE_DIA.test(ymd)) return false;
  // `Date.UTC` acepta 2026-02-31 y lo corre a marzo: se compara de vuelta.
  return aYmd(msDia(ymd)) === ymd;
}

/** Día de Bogotá en el instante `ahora`. */
export function hoyBogota(ahora: Date): string {
  return aYmd(ahora.getTime() - DESFASE_MS);
}

/** Día de Bogotá al que pertenece un instante (para casar filas con días). */
export function diaBogotaDe(instante: Date): string {
  return hoyBogota(instante);
}

export function sumarDias(ymd: string, n: number): string {
  return aYmd(msDia(ymd) + n * DIA_MS);
}

/** Días del rango contando los dos extremos (hoy → 1). */
export function diasDelRango(r: Rango): number {
  return Math.round((msDia(r.hasta) - msDia(r.desde)) / DIA_MS) + 1;
}

function ultimoDiaDelMes(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m en 1..12 → día 0 del siguiente
}

function ymdDe(y: number, m: number, d: number): string {
  return aYmd(Date.UTC(y, m - 1, d));
}

export class RangoInvalido extends Error {}

/**
 * Rango de un preset. Con `personalizado`, `desde`/`hasta` son obligatorios;
 * un `hasta` en el futuro se recorta a hoy (pedir «hasta fin de mes» el día
 * 19 no debe pintar 11 días vacíos que parecen una caída).
 */
export function rangoDePreset(
  preset: Preset,
  ahora: Date,
  desde?: string,
  hasta?: string,
): Rango {
  const hoy = hoyBogota(ahora);
  const [y, m] = partes(hoy);
  switch (preset) {
    case 'hoy':
      return { desde: hoy, hasta: hoy };
    case '7d':
      return { desde: sumarDias(hoy, -6), hasta: hoy };
    case '30d':
      return { desde: sumarDias(hoy, -29), hasta: hoy };
    case '90d':
      return { desde: sumarDias(hoy, -89), hasta: hoy };
    case 'mes':
      return { desde: ymdDe(y, m, 1), hasta: hoy };
    case 'mesAnterior': {
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { desde: ymdDe(py, pm, 1), hasta: ymdDe(py, pm, ultimoDiaDelMes(py, pm)) };
    }
    case 'personalizado': {
      if (!esDiaValido(desde) || !esDiaValido(hasta)) {
        throw new RangoInvalido('Las fechas del rango deben tener el formato AAAA-MM-DD.');
      }
      if (desde > hasta) throw new RangoInvalido('La fecha inicial es posterior a la final.');
      if (desde > hoy) throw new RangoInvalido('El rango empieza en el futuro.');
      const r = { desde, hasta: hasta > hoy ? hoy : hasta };
      if (diasDelRango(r) > MAX_DIAS_RANGO) {
        throw new RangoInvalido(`El rango no puede pasar de ${MAX_DIAS_RANGO} días.`);
      }
      return r;
    }
  }
}

/**
 * El período anterior EQUIVALENTE, contra el que se calcula el ▲/▼.
 *
 * - «Este mes» (1 al 19 de octubre) se compara con el 1 al 19 de septiembre,
 *   no con los 19 días anteriores (que cruzarían el cambio de mes y mezclarían
 *   la quincena de pago de cada uno).
 * - «Mes anterior» se compara con el mes completo de antes, aunque tenga otro
 *   número de días: es la pregunta «¿cómo nos fue en septiembre vs. agosto?».
 * - El resto: los mismos N días, justo antes.
 */
export function periodoAnterior(r: Rango, preset: Preset): Rango {
  if (preset === 'mes' || preset === 'mesAnterior') {
    const [y, m, dHasta] = partes(r.hasta);
    const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
    const ultimo = ultimoDiaDelMes(py, pm);
    const dia = preset === 'mesAnterior' ? ultimo : Math.min(dHasta, ultimo);
    return { desde: ymdDe(py, pm, 1), hasta: ymdDe(py, pm, dia) };
  }
  const n = diasDelRango(r);
  return { desde: sumarDias(r.desde, -n), hasta: sumarDias(r.desde, -1) };
}

/** Límites en UTC para la consulta: `[gte, lt)`. */
export function limitesUtc(r: Rango): { gte: Date; lt: Date } {
  return {
    gte: new Date(msDia(r.desde) + DESFASE_MS),
    lt: new Date(msDia(sumarDias(r.hasta, 1)) + DESFASE_MS),
  };
}

export function contieneDia(r: Rango, ymd: string): boolean {
  return ymd >= r.desde && ymd <= r.hasta;
}

export type Granularidad = 'dia' | 'semana';

export function granularidadDe(r: Rango): Granularidad {
  return diasDelRango(r) > MAX_DIAS_POR_DIA ? 'semana' : 'dia';
}

/** Lunes de la semana de `ymd` (semanas de lunes a domingo, como en Colombia). */
export function lunesDe(ymd: string): string {
  const dow = new Date(msDia(ymd)).getUTCDay(); // 0 = domingo
  return sumarDias(ymd, -((dow + 6) % 7));
}

export interface Tramo<K extends string> {
  /** Primer día del tramo (dentro del rango). */
  desde: string;
  /** Último día del tramo (dentro del rango). */
  hasta: string;
  valores: Record<K, number>;
}

/**
 * Reparte series diarias en tramos de un día o de una semana, rellenando con
 * ceros los días sin filas (la base solo devuelve los días con algo, y una
 * gráfica sin los huecos miente sobre la frecuencia).
 *
 * Por semana, el primer y el último tramo se recortan al rango: la semana del
 * 1 de octubre empieza el lunes 29 de septiembre, pero no se cuenta lo de
 * septiembre en una consulta de octubre.
 */
export function tramosDeSerie<K extends string>(
  r: Rango,
  gran: Granularidad,
  series: Record<K, Map<string, number>>,
): Tramo<K>[] {
  const claves = Object.keys(series) as K[];
  const tramos: Tramo<K>[] = [];
  let actual: Tramo<K> | null = null;
  for (let d = r.desde; d <= r.hasta; d = sumarDias(d, 1)) {
    const inicio = gran === 'dia' ? d : lunesDe(d) < r.desde ? r.desde : lunesDe(d);
    if (!actual || actual.desde !== inicio) {
      actual = {
        desde: inicio,
        hasta: d,
        valores: Object.fromEntries(claves.map((k) => [k, 0])) as Record<K, number>,
      };
      tramos.push(actual);
    }
    actual.hasta = d;
    for (const k of claves) actual.valores[k] += series[k].get(d) ?? 0;
  }
  return tramos;
}

/** Suma los valores de una serie diaria que caen dentro del rango. */
export function sumaEnRango(serie: Map<string, number>, r: Rango): number {
  let s = 0;
  for (const [dia, v] of serie) if (contieneDia(r, dia)) s += v;
  return s;
}

export interface Variacion {
  /** % redondeado a un decimal; `null` cuando el anterior fue 0 y hoy no. */
  pct: number | null;
  tendencia: 'sube' | 'baja' | 'igual' | 'nuevo';
}

/**
 * ▲/▼ frente al período anterior. Con el anterior en 0, «+∞ %» no dice nada:
 * se marca como `nuevo` y el panel lo escribe en palabras.
 */
export function variacion(actual: number, anterior: number): Variacion {
  if (anterior === 0) {
    return actual === 0 ? { pct: 0, tendencia: 'igual' } : { pct: null, tendencia: 'nuevo' };
  }
  const pct = Math.round(((actual - anterior) / anterior) * 1000) / 10;
  return { pct, tendencia: pct > 0 ? 'sube' : pct < 0 ? 'baja' : 'igual' };
}
