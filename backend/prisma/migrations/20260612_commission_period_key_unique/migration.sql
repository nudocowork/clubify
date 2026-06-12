-- Commission.periodKey + UNIQUE(referralUseId, recipientCodeId, periodKey)
-- Sprint 2026-06-12: previene duplicados a nivel DB.

-- 1) Agregar columna (nullable, backwards-compat).
ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "periodKey" TEXT;

-- 2) Backfill: derivamos periodKey de createdAt (YYYY-MM). Solo filas
--    con recipientCodeId NOT NULL — las legacy con null no afectan UNIQUE
--    porque PostgreSQL trata NULLs como distintos.
UPDATE "Commission"
SET "periodKey" = to_char("createdAt", 'YYYY-MM')
WHERE "periodKey" IS NULL AND "recipientCodeId" IS NOT NULL;

-- 3) UNIQUE constraint. NULLs no chocan (PG default).
CREATE UNIQUE INDEX IF NOT EXISTS "Commission_referralUseId_recipientCodeId_periodKey_key"
  ON "Commission"("referralUseId", "recipientCodeId", "periodKey");
