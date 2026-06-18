-- Aislamiento por marca de los afiliados: cada ReferralCode pertenece a una
-- marca blanca. Backfill: todos los existentes → "Clubify".

ALTER TABLE "ReferralCode" ADD COLUMN "whiteLabelId" TEXT;

UPDATE "ReferralCode"
SET "whiteLabelId" = (SELECT "id" FROM "WhiteLabel" WHERE "slug" = 'clubify' LIMIT 1)
WHERE "whiteLabelId" IS NULL;

ALTER TABLE "ReferralCode"
  ADD CONSTRAINT "ReferralCode_whiteLabelId_fkey"
  FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ReferralCode_whiteLabelId_idx" ON "ReferralCode"("whiteLabelId");
