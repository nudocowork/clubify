-- Remove PRO from QuotePlan enum (Pro plan deprecated, only Elite remains).
-- Pattern: rename old enum → create new enum → swap column → drop old enum.
-- Quotes con plan=PRO se convierten a ELITE (los precios snapshot quedan
-- intactos, solo cambia el label del plan).

BEGIN;

-- 1) Convertir cualquier dato existente PRO → ELITE antes de cambiar el tipo
UPDATE "Quote" SET "plan" = 'ELITE' WHERE "plan" = 'PRO';

-- 2) Renombrar enum viejo
ALTER TYPE "QuotePlan" RENAME TO "QuotePlan_old";

-- 3) Crear enum nuevo solo con ELITE
CREATE TYPE "QuotePlan" AS ENUM ('ELITE');

-- 4) Cambiar columna al nuevo tipo
ALTER TABLE "Quote"
  ALTER COLUMN "plan" TYPE "QuotePlan"
  USING ("plan"::text::"QuotePlan");

-- 5) Drop enum viejo
DROP TYPE "QuotePlan_old";

COMMIT;
