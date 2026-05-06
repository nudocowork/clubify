-- Mensajería del flujo de pedidos (Pro-only):
-- - whatsappOrdersPhone: número del negocio/caja para pedidos de cliente
-- - whatsappDeliveryPhone: número del courier de domicilio
ALTER TABLE "Tenant" ADD COLUMN "whatsappOrdersPhone" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "whatsappDeliveryPhone" TEXT;
