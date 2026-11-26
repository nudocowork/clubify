/**
 * Qué escaneo cuenta como una VENTA del negocio (facturación del panel y
 * totales del cliente: `totalOrdersAmount`, `totalOrdersCount`).
 *
 * POR QUÉ EXISTE (auditoría 2026-11-26): solo contaban STAMP y VISIT. Un
 * negocio de cashback (CASHBACK_ADD) o de VIP por gasto veía $0 facturado
 * aunque cada escaneo llevara la compra, y el escáner le prometía «el monto
 * alimenta los KPIs de facturación».
 *
 * Sin doble conteo, por tres razones:
 *  · cada escaneo es UNA acción: el escáner no manda STAMP y CASHBACK_ADD por
 *    la misma compra (la tarjeta decide cuál);
 *  · los POINTS_ADD que genera un pedido llevan `orderId` y ya cuentan en el
 *    total del pedido — quien suma aquí filtra `orderId: null`;
 *  · un regalo guarda `purchaseAmount` en null: nunca entra.
 *
 * Pura y sin base de datos.
 */

export const ACCIONES_DE_COMPRA = ['STAMP', 'VISIT', 'CASHBACK_ADD', 'POINTS_ADD'] as const;

/** ¿Este escaneo (sin pedido detrás) es una compra con monto? */
export function esCompraRegistrada(o: {
  accion: string;
  purchaseAmount: unknown;
  orderId?: string | null;
}): boolean {
  if (o.orderId) return false;
  if (!(ACCIONES_DE_COMPRA as readonly string[]).includes(o.accion)) return false;
  const n = Number(o.purchaseAmount ?? 0);
  return Number.isFinite(n) && n > 0;
}
