-- Sellea Infolinks Freemium — nivel del InfoLink (FREE/PRO) por negocio.
-- Aditivo + no-destructivo. Solo aplica a businessType=INFOLINK; FULL queda null.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InfolinkTier') THEN
    CREATE TYPE "InfolinkTier" AS ENUM ('FREE', 'PRO');
  END IF;
END $$;

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "infolinkTier" "InfolinkTier";

-- Backfill: los InfoLink existentes ya pagan 0.25 (crédito de marca) → PRO,
-- así conservan todas sus funciones. Los FULL quedan null (no aplica).
UPDATE "Tenant" SET "infolinkTier" = 'PRO'
 WHERE "businessType" = 'INFOLINK' AND "infolinkTier" IS NULL;
