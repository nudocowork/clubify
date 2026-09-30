/**
 * Orden de las sedes que entran al pase.
 *
 * Apple y Google admiten 10 puntos por tarjeta y las dos billeteras cortan con
 * `slice(0, 10)`. Sin un orden, cuáles 10 entran lo decidía el azar de la
 * consulta: al pasar de 10 (una cuponera con muchos aliados), un punto que
 * ayer avisaba hoy podía dejar de hacerlo sin que nadie tocara nada.
 *
 * Regla: primero los puntos PROPIOS del negocio (o de la cuponera), después
 * las sedes espejo de sus aliados; dentro de cada grupo, por antigüedad. Así
 * los pocos puntos que el dueño creó a mano nunca los desplaza la sede de un
 * aliado, y el corte es estable: el mismo pase avisa siempre en los mismos
 * sitios. Para un negocio normal (sin aliados) esto es simplemente
 * «por antigüedad».
 *
 * Requiere que la consulta ya venga con `orderBy: { createdAt: 'asc' }`: el
 * sort de acá es estable y solo reparte en dos grupos.
 */

/** Prefijo del `externalId` de la `Location` espejo de la sede de un aliado.
 *  Lo escribe `CuponeraService.syncAllyGeofence`; vive acá para que la
 *  billetera no tenga que importar la cuponera (sería un ciclo). */
export const PREFIJO_GEOFENCE_ALIADO = 'aliado:';

export function ordenarSedesParaPase<T extends { externalId?: string | null }>(
  sedes: T[],
): T[] {
  const rango = (s: T) =>
    s.externalId?.startsWith(PREFIJO_GEOFENCE_ALIADO) ? 1 : 0;
  return [...sedes].sort((a, b) => rango(a) - rango(b));
}
