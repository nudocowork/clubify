/**
 * Períodos y cupos de la Tarjeta de Club.
 *
 * Sin dependencias: son las reglas puras, para poder probarlas de verdad. El
 * módulo de Convenios se llevó la lección contraria — sus tests reimplementan
 * la lógica dentro del propio fichero y por eso pasan sin proteger nada.
 */

/** El negocio y sus clientes viven en Bogotá; los períodos también. */
const TZ_BOGOTA = 'America/Bogota';

/**
 * El mes al que pertenece un instante, en hora de Bogotá: "2026-09".
 *
 * Se usa hora local y no UTC a propósito: un consumo del 30 de septiembre a
 * las 8 de la noche en Bogotá son las 01:00 UTC del 1 de octubre. Contándolo
 * en UTC, ese café saldría del cupo de octubre y el cliente perdería uno.
 */
export function periodoDe(fecha: Date, tz: string = TZ_BOGOTA): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(fecha);
  const y = partes.find((p) => p.type === 'year')?.value;
  const m = partes.find((p) => p.type === 'month')?.value;
  return `${y}-${m}`;
}

/** Día del mes (1..31) en hora de Bogotá. */
export function diaDelMes(fecha: Date, tz: string = TZ_BOGOTA): number {
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    day: '2-digit',
  }).format(fecha);
  return Number(d);
}

export type TramoAlta = {
  desdeDia: number;
  hastaDia: number;
  beneficios: number;
};

/**
 * Cuántos beneficios recibe quien se da de alta HOY.
 *
 * El negocio parte el mes en tramos: "del 1 al 15 → 10", "del 25 al 31 → 3".
 * Es solo para el primer período; del mes siguiente en adelante recibe el
 * cupo completo.
 *
 * Sin tramos configurados devuelve el cupo entero, que es lo que esperaría
 * quien no configuró nada. Y si los tramos dejan un día sin cubrir, ese día
 * también recibe el cupo entero: es preferible regalar de más a que un
 * cliente que pagó se quede en cero por un hueco en la configuración.
 */
export function cupoDeAlta(
  diaDeAlta: number,
  cupoMensual: number,
  tramos: TramoAlta[],
): number {
  const t = tramos.find(
    (x) => diaDeAlta >= x.desdeDia && diaDeAlta <= x.hastaDia,
  );
  if (!t) return cupoMensual;
  // Nunca más que el cupo del mes: un tramo mal puesto no puede convertir el
  // alta en un regalo mayor que la propia suscripción.
  return Math.max(0, Math.min(t.beneficios, cupoMensual));
}

/** Por qué un conjunto de tramos no sirve, o `null` si está bien. */
export function errorDeTramos(tramos: TramoAlta[]): string | null {
  for (const t of tramos) {
    if (!Number.isInteger(t.desdeDia) || !Number.isInteger(t.hastaDia)) {
      return 'Los días deben ser números enteros.';
    }
    if (t.desdeDia < 1 || t.hastaDia > 31) {
      return 'Los días van del 1 al 31.';
    }
    if (t.desdeDia > t.hastaDia) {
      return `El tramo del ${t.desdeDia} al ${t.hastaDia} empieza después de terminar.`;
    }
    if (!Number.isInteger(t.beneficios) || t.beneficios < 0) {
      return 'Los beneficios deben ser un número entero de 0 en adelante.';
    }
  }
  // Solapes: dos tramos que cubran el mismo día dejarían el alta a merced del
  // orden de la consulta, y el negocio no entendería por qué a dos clientes
  // del mismo día les tocó distinto.
  const orden = [...tramos].sort((a, b) => a.desdeDia - b.desdeDia);
  for (let i = 1; i < orden.length; i++) {
    if (orden[i].desdeDia <= orden[i - 1].hastaDia) {
      return `Los tramos del ${orden[i - 1].desdeDia}-${orden[i - 1].hastaDia} y del ${orden[i].desdeDia}-${orden[i].hastaDia} se pisan.`;
    }
  }
  return null;
}

/**
 * ¿Hay que reiniciarle el cupo a esta membresía?
 *
 * Toda la idempotencia del reinicio vive aquí: se compara el período GUARDADO
 * con el actual. Correr el cron dos veces el mismo mes no regala nada, y una
 * membresía que estuvo pausada tres meses vuelve con UN cupo, no con tres.
 *
 * Una membresía pausada no se reinicia: si no está pagando, no recibe.
 */
export function tocaReiniciar(
  m: { status: string; periodo: string },
  periodoActual: string,
): boolean {
  if (m.status !== 'ACTIVA') return false;
  return m.periodo !== periodoActual;
}

/** Cada cuánto paga el socio. Solo dos, y el precio se lee con esto. */
export type Periodicidad = 'MENSUAL' | 'ANUAL';

/**
 * Normaliza la periodicidad que llega de fuera.
 *
 * Lo que NO cambia según esto: el cupo. Se repone el día 1 de cada mes en los
 * dos casos —quien paga el año por adelantado recibe sus beneficios mes a mes
 * igual que el que paga cada mes, y por eso el anual se puede vender más
 * barato—. Un cupo anual entregado de golpe sería otro producto: el socio se lo
 * gastaría en enero y el negocio tendría once meses de cliente sin nada que
 * darle.
 *
 * Cualquier valor desconocido cae en MENSUAL, que es lo que eran todos los
 * planes antes de que esto existiera: un plan no puede quedarse sin decir cómo
 * se lee su precio.
 */
export function periodicidadValida(valor?: string | null): Periodicidad {
  return String(valor ?? '').trim().toUpperCase() === 'ANUAL'
    ? 'ANUAL'
    : 'MENSUAL';
}
