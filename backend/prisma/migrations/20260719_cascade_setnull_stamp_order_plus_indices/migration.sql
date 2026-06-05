-- HOTFIX 2026-06-05: FK constraints + índices que faltaban.
--
-- 1) onDelete: SetNull en Stamp.location/operator/order y Order.location.
--    Antes era default Postgres "NO ACTION" → borrar una Location, User
--    o Order con stamps históricos crashea con FK violation. Como hay
--    UI para borrar Locations + Users (staff), eventualmente algún
--    cliente lo intenta y rompe.
--    Patrón consistente con Card.location que ya tiene SetNull.
--
-- 2) Índices nuevos para los filtros de customers introducidos en M6
--    (2026-06-04): filtra stamps por tenantId+locationId+createdAt y
--    tenantId+operatorId+createdAt. Sin índice, seq scan en tenants
--    con histórico grande.

-- Stamp FKs
ALTER TABLE "Stamp" DROP CONSTRAINT IF EXISTS "Stamp_locationId_fkey";
ALTER TABLE "Stamp" ADD CONSTRAINT "Stamp_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Stamp" DROP CONSTRAINT IF EXISTS "Stamp_operatorId_fkey";
ALTER TABLE "Stamp" ADD CONSTRAINT "Stamp_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Stamp" DROP CONSTRAINT IF EXISTS "Stamp_orderId_fkey";
ALTER TABLE "Stamp" ADD CONSTRAINT "Stamp_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Order.location FK
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_locationId_fkey";
ALTER TABLE "Order" ADD CONSTRAINT "Order_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Índices nuevos para M6 customer filters.
CREATE INDEX IF NOT EXISTS "Stamp_tenantId_locationId_createdAt_idx"
  ON "Stamp"("tenantId", "locationId", "createdAt");

CREATE INDEX IF NOT EXISTS "Stamp_tenantId_operatorId_createdAt_idx"
  ON "Stamp"("tenantId", "operatorId", "createdAt");
