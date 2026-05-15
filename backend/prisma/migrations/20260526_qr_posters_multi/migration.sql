-- Permite múltiples QrPoster por (tenantId, type). Antes había un unique
-- compuesto que limitaba a 1 cartel por categoría por tenant. Drop unique
-- y dejar índice plano para performance de listados.
ALTER TABLE "QrPoster" DROP CONSTRAINT IF EXISTS "QrPoster_tenantId_type_key";
DROP INDEX IF EXISTS "QrPoster_tenantId_type_key";
CREATE INDEX IF NOT EXISTS "QrPoster_tenantId_type_idx" ON "QrPoster"("tenantId", "type");
