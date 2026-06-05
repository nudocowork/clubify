-- M1.3 (2026-06-04): eliminamos el toggle redundante `ordersWhatsappEnabled`.
-- La regla nueva es: si Delivery está ON, el botón WhatsApp aparece
-- automáticamente. No tiene sentido un toggle aparte porque "Delivery con
-- carrito pero sin canal para enviar el pedido" no es un caso real.
-- Tenants que tenían el flag en false pierden esa preferencia
-- intencionalmente (compat-free según decisión del founder).
ALTER TABLE "Storefront" DROP COLUMN "ordersWhatsappEnabled";
