/**
 * Método de pago que el CLIENTE declara al hacer un pedido público
 * (Order.customerPaymentMethod). Fuente única para:
 *  - la etiqueta humana que va en los mensajes (WhatsApp/SMS): el dueño lee
 *    «Pago: efectivo», nunca el enum crudo «EFECTIVO»;
 *  - la lista de métodos que un negocio acepta (Storefront.theme.paymentMethods,
 *    JSON sin migración — mismo patrón que theme.fulfillment) y su validación
 *    server-side en el alta pública de pedidos.
 */

export const CUSTOMER_PAYMENT_METHODS = [
  'EFECTIVO',
  'TARJETA',
  'TRANSFERENCIA',
  'OTRO',
] as const;

export type CustomerPaymentMethod = (typeof CUSTOMER_PAYMENT_METHODS)[number];

export function isCustomerPaymentMethod(
  v: unknown,
): v is CustomerPaymentMethod {
  return (
    typeof v === 'string' &&
    (CUSTOMER_PAYMENT_METHODS as readonly string[]).includes(v)
  );
}

/**
 * Etiqueta en español natural para mensajes que leen personas.
 * OTRO usa el texto libre que escribió el cliente («Nequi», «Daviplata»…);
 * si no lo escribió, cae a «otro». Un valor desconocido (dato legacy o
 * editado a mano) se devuelve tal cual para no inventar ni ocultar nada.
 * Devuelve '' si no hay método → el llamador omite la línea entera.
 */
export function customerPaymentLabel(
  method?: string | null,
  other?: string | null,
): string {
  const m = (method ?? '').trim();
  if (!m) return '';
  switch (m) {
    case 'EFECTIVO':
      return 'efectivo';
    case 'TARJETA':
      return 'tarjeta';
    case 'TRANSFERENCIA':
      return 'transferencia';
    case 'OTRO':
      return other?.trim() || 'otro';
    default:
      return m;
  }
}

/**
 * Normaliza la lista de métodos aceptados guardada en theme.paymentMethods.
 * Devuelve null cuando el negocio NO configuró nada (clave ausente, basura o
 * lista vacía) → el llamador ofrece TODOS los métodos. Un default vacío
 * dejaría el checkout sin opciones = caída de ventas silenciosa; por eso
 * «vacío» y «sin configurar» son lo mismo a propósito.
 */
export function normalizeAcceptedPaymentMethods(
  raw: unknown,
): CustomerPaymentMethod[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<CustomerPaymentMethod>();
  for (const v of raw) {
    if (isCustomerPaymentMethod(v)) seen.add(v);
  }
  if (seen.size === 0) return null;
  // Orden canónico (el del checkout), no el orden en que se guardó.
  return CUSTOMER_PAYMENT_METHODS.filter((m) => seen.has(m));
}
