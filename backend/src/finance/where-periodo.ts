/**
 * Cómo se acota por período cada tabla de Contabilidad.
 *
 * Vive aquí y no en cada servicio porque el reporte, el libro de caja y los
 * listados TIENEN que acotar igual: si el reporte cuenta un corte de nómina en
 * septiembre y Movimientos lo pinta en agosto, el módulo se contradice a sí
 * mismo y no hay forma de cuadrar un mes.
 */

import { limitesDelPeriodo } from '../common/periodo-contable';

export type Rango = { from?: Date; to?: Date };

/**
 * El rango de un `period` de la URL ("2026-09", "2026-T3", "2026", "todo").
 * Un período que no se entiende NO revienta la pantalla: cae al histórico
 * completo, que es lo que se veía antes de que existiera el selector.
 */
export function rangoDe(period?: string): Rango {
  return limitesDelPeriodo(period) ?? {};
}

const limites = (r: Rango) => ({
  ...(r.from ? { gte: r.from } : {}),
  ...(r.to ? { lte: r.to } : {}),
});

/** `{ saleDate: { gte, lte } }` — para la tabla que sí tiene su fecha propia. */
export function enRango(campo: string, r: Rango): Record<string, unknown> {
  return r.from || r.to ? { [campo]: limites(r) } : {};
}

/**
 * Igual, pero con RESPALDO por `createdAt` para las filas que traen el campo
 * en null. `PayrollRun.periodEnd` y `Commission.businessDate` son opcionales;
 * filtrando solo por ellos, esas filas se caían del `where` y el período las
 * contaba como CERO — así es como la nómina desaparecía del reporte y la
 * utilidad salía inflada. Mismo respaldo que ya usan `referrals.service` y el
 * módulo `accounting`.
 */
export function enRangoConRespaldo(
  campo: string,
  r: Rango,
): Record<string, unknown> {
  if (!r.from && !r.to) return {};
  const l = limites(r);
  return { OR: [{ [campo]: l }, { [campo]: null, createdAt: l }] };
}
