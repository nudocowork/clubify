-- C7: sync de contactos desde Grow Business.
-- Cada afiliado conecta SU propia subcuenta GB (creds en User).
-- CrmContact gana externalContactId + externalSource para dedup en
-- próximos pulls (no duplicar contactos ya sincronizados).

ALTER TABLE "User" ADD COLUMN "crmGbLocationId" TEXT;
ALTER TABLE "User" ADD COLUMN "crmGbApiKey" TEXT;
ALTER TABLE "User" ADD COLUMN "crmGbLocationName" TEXT;
ALTER TABLE "User" ADD COLUMN "crmGbConnectedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "crmGbLastSyncAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "crmGbLastSyncCount" INTEGER;

ALTER TABLE "CrmContact" ADD COLUMN "externalContactId" TEXT;
ALTER TABLE "CrmContact" ADD COLUMN "externalSource" TEXT;

CREATE INDEX "CrmContact_ownerUserId_externalContactId_idx"
  ON "CrmContact"("ownerUserId", "externalContactId");
