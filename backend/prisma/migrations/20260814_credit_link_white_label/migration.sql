-- Acreditación de créditos por RELACIÓN DIRECTA (product+offer → marca), no por
-- correo del comprador. Cada HotmartCreditLink pertenece a una marca blanca.
ALTER TABLE "HotmartCreditLink" ADD COLUMN IF NOT EXISTS "whiteLabelId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'HotmartCreditLink_whiteLabelId_fkey'
  ) THEN
    ALTER TABLE "HotmartCreditLink"
      ADD CONSTRAINT "HotmartCreditLink_whiteLabelId_fkey"
      FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "HotmartCreditLink_whiteLabelId_idx" ON "HotmartCreditLink"("whiteLabelId");
CREATE INDEX IF NOT EXISTS "HotmartCreditLink_hotmartProductId_hotmartOfferCode_idx" ON "HotmartCreditLink"("hotmartProductId", "hotmartOfferCode");
