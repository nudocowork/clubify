-- Conversion tracking de cotizaciones. Cuando el cliente firma el plan
-- desde /q/<publicToken>, lo mandamos a /signup?qt=<publicToken>; el
-- signup lo busca y setea convertedAt + convertedToTenantId.
--
-- onDelete: SET NULL para que si el tenant resultante se elimina, la
-- cotización siga existiendo (con la marca de "convertido" pero sin link).
-- Idempotente con IF NOT EXISTS — Railway-friendly.

ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "convertedAt"          TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "convertedToTenantId"  TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Quote_convertedToTenantId_fkey'
  ) THEN
    ALTER TABLE "Quote"
      ADD CONSTRAINT "Quote_convertedToTenantId_fkey"
      FOREIGN KEY ("convertedToTenantId") REFERENCES "Tenant"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Quote_convertedToTenantId_idx" ON "Quote"("convertedToTenantId");
