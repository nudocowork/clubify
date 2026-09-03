-- Método de pago declarado por el cliente (o editado por el negocio) en el
-- pedido — informativo, independiente del gateway online. PDF 2026-07-25.
-- Idempotente (IF NOT EXISTS).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerPaymentMethod" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerPaymentOther" TEXT;
