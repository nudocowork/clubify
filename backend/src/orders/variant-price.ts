/**
 * Precio unitario de un producto según la variante (tamaño/presentación)
 * elegida.
 *
 * Vive como función pura fuera de OrdersService porque el MISMO cálculo se
 * repite en los tres caminos que arman items de pedido (público, interno y
 * edición): si uno diverge, al cliente se le cobra distinto según por dónde
 * entró el pedido. Los tests de `variant-price.spec.ts` fijan el contrato
 * DELTA vs ABSOLUTE para que un refactor no lo rompa en silencio.
 *
 * - `ABSOLUTE`: la variante define su precio propio TOTAL — `priceDelta`
 *   guarda el precio final y reemplaza al base (ej. «Torre pequeña» $34.900,
 *   «Torre personal» $44.900).
 * - `DELTA` (default histórico): la variante SUMA su `priceDelta` al base.
 *   Cualquier valor desconocido o nulo cae aquí: los productos creados antes
 *   de que existiera el campo deben seguir cobrando igual que siempre.
 *
 * Los extras SIEMPRE suman encima del resultado, en ambos modos — eso queda
 * en el caller porque requiere validar cada extra contra el producto.
 */
export function variantUnitPrice(
  basePrice: number,
  variantPriceMode: string | null | undefined,
  priceDelta: number,
): number {
  return variantPriceMode === 'ABSOLUTE' ? priceDelta : basePrice + priceDelta;
}
