-- Subcuentas globales de Grow Business + asignación opcional desde Tenant.

CREATE TABLE "GrowBusinessAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "apiKey" TEXT NOT NULL,
  "switchNumber" INTEGER,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "lastTestAt" TIMESTAMP(3),
  "lastTestOk" BOOLEAN,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3)
);

ALTER TABLE "Tenant" ADD COLUMN "reviewAlertsAccountId" TEXT;
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_reviewAlertsAccountId_fkey"
  FOREIGN KEY ("reviewAlertsAccountId")
  REFERENCES "GrowBusinessAccount"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
