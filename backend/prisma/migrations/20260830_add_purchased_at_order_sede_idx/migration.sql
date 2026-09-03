-- PDF Soft 10: fecha REAL de compra del tenant (no la de creación de la cuenta)
-- + índice para el filtro de pedidos por sede. Ambos idempotentes.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "purchasedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Order_tenantId_locationId_status_idx" ON "Order"("tenantId", "locationId", "status");
