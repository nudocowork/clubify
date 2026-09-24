/**
 * La fecha de un movimiento contable la pone la PERSONA, nunca el reloj.
 *
 * EL FALLO (2026-09-24, reportado por Javier): estando en mayo de 2026, crear
 * un egreso lo guardaba en SEPTIEMBRE. El formulario no tenía campo de fecha y
 * el backend caía a `new Date()`. El movimiento desaparecía del período donde
 * se estaba trabajando y aparecía en otro, sin decir nada.
 *
 * Dos reglas, y las dos viven aquí para que el frontend y el backend no puedan
 * discrepar:
 *
 *  1. La fecha se compara como TEXTO (`YYYY-MM-DD` contra el período). Sin
 *     husos horarios de por medio no hay forma de que el 1 de mayo caiga en
 *     abril, que es exactamente lo que pasa si se compara en UTC: las 00:00 del
 *     1 de mayo en UTC son las 19:00 del 30 de abril en Bogotá.
 *  2. Para GUARDAR, ese día se convierte al MEDIODÍA de Bogotá. Cualquier hora
 *     entre las 05:00 y las 23:59 UTC vale; el mediodía deja margen a los dos
 *     lados y sobrevive a que alguien lea la fila en otra zona.
 */

/** Offset fijo de Bogotá: UTC-5 todo el año. Igual que `periodo-contable.ts`. */
const OFFSET_BOGOTA_HORAS = 5;

export const ES_UN_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** El día de hoy en Bogotá, como "YYYY-MM-DD". */
export function hoyEnBogota(ahora: Date = new Date()): string {
  const bogota = new Date(ahora.getTime() - OFFSET_BOGOTA_HORAS * 3600_000);
  return bogota.toISOString().slice(0, 10);
}

/**
 * "2026-05-15" → el instante que se guarda en la base (mediodía de Bogotá).
 * Devuelve `null` si el día no existe (un 31 de febrero, por ejemplo).
 */
export function instanteDelDia(ymd: string): Date | null {
  if (!ES_UN_DIA.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  // `Date.UTC` con un día que no existe hace rebosar al mes siguiente en vez de
  // fallar: se compara de vuelta para cazarlo.
  const instante = new Date(Date.UTC(y, m - 1, d, 12 + OFFSET_BOGOTA_HORAS, 0, 0, 0));
  const vuelta = new Date(instante.getTime() - OFFSET_BOGOTA_HORAS * 3600_000)
    .toISOString()
    .slice(0, 10);
  return vuelta === ymd ? instante : null;
}

/** Los meses que abarca un período: ["2026-04","2026-05","2026-06"]. */
function mesesDe(periodo: string): string[] | null {
  const p = (periodo ?? '').trim();
  const mes = /^(\d{4})-(\d{2})$/.exec(p);
  if (mes) {
    const n = Number(mes[2]);
    return n >= 1 && n <= 12 ? [p] : null;
  }
  const tri = /^(\d{4})-T([1-4])$/i.exec(p);
  if (tri) {
    const primero = (Number(tri[2]) - 1) * 3 + 1;
    return [0, 1, 2].map(
      (i) => `${tri[1]}-${String(primero + i).padStart(2, '0')}`,
    );
  }
  const anio = /^(\d{4})$/.exec(p);
  if (anio) {
    return Array.from(
      { length: 12 },
      (_, i) => `${anio[1]}-${String(i + 1).padStart(2, '0')}`,
    );
  }
  return null;
}

/**
 * ¿Pertenece este día al período que se está gestionando?
 *
 * "todo", vacío o un período que no se entiende → `true`: no hay período contra
 * el que contrastar, así que no se le estorba a nadie.
 */
export function fechaDentroDelPeriodo(
  ymd: string,
  periodo?: string | null,
): boolean {
  if (!ES_UN_DIA.test(ymd)) return false;
  const p = (periodo ?? '').trim();
  if (!p || p === 'todo') return true;
  const meses = mesesDe(p);
  if (!meses) return true;
  return meses.includes(ymd.slice(0, 7));
}

/**
 * Qué fecha traer puesta al abrir el formulario.
 *
 * Hoy SOLO si hoy cae dentro del período que se está mirando. Si no, el primer
 * día del período — nunca la fecha del sistema, que es justo lo que mandaba el
 * movimiento al mes equivocado.
 */
export function diaPorDefecto(
  periodo?: string | null,
  ahora: Date = new Date(),
): string {
  const hoy = hoyEnBogota(ahora);
  const p = (periodo ?? '').trim();
  if (!p || p === 'todo') return hoy;
  const meses = mesesDe(p);
  if (!meses) return hoy;
  if (meses.includes(hoy.slice(0, 7))) return hoy;
  return `${meses[0]}-01`;
}
