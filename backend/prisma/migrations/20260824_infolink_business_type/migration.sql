-- InfoLink como tipo de negocio + créditos fraccionados (0.25). Aditivo.
--
-- 1) Enum BusinessType (FULL / INFOLINK). Idempotente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BusinessType') THEN
    CREATE TYPE "BusinessType" AS ENUM ('FULL', 'INFOLINK');
  END IF;
END$$;

-- 2) Columna Tenant.businessType. Todos los negocios existentes → FULL.
ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "businessType" "BusinessType" NOT NULL DEFAULT 'FULL';

-- 3) Créditos de la marca pasan a punto flotante para soportar fracciones
--    (InfoLink = 0.25/mes). Los valores enteros existentes se preservan.
ALTER TABLE "WhiteLabel" ALTER COLUMN "creditsAvailable" SET DATA TYPE double precision;
ALTER TABLE "WhiteLabel" ALTER COLUMN "creditsCommitted" SET DATA TYPE double precision;
ALTER TABLE "WhiteLabel" ALTER COLUMN "creditsUsed" SET DATA TYPE double precision;

-- 4) Ledger de créditos: el monto puede ser fraccionado (-0.25).
ALTER TABLE "CreditTransaction" ALTER COLUMN "amount" SET DATA TYPE double precision;
