-- Grupos Empresariales: una suscripción Hotmart por varios negocios.
CREATE TYPE "BusinessGroupStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'SUSPENDED');

CREATE TABLE "BusinessGroup" (
  "id" TEXT NOT NULL,
  "whiteLabelId" TEXT,
  "name" TEXT NOT NULL,
  "responsibleName" TEXT,
  "responsibleEmail" TEXT,
  "responsiblePhone" TEXT,
  "hotmartSubscriberCode" TEXT,
  "planPeriodicity" TEXT,
  "currentPeriodEnd" TIMESTAMP(3),
  "status" "BusinessGroupStatus" NOT NULL DEFAULT 'ACTIVE',
  "failedPaymentCount" INTEGER NOT NULL DEFAULT 0,
  "suspendedAt" TIMESTAMP(3),
  "lastChargeAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "BusinessGroup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BusinessGroup_whiteLabelId_idx" ON "BusinessGroup"("whiteLabelId");
CREATE INDEX "BusinessGroup_hotmartSubscriberCode_idx" ON "BusinessGroup"("hotmartSubscriberCode");

ALTER TABLE "BusinessGroup" ADD CONSTRAINT "BusinessGroup_whiteLabelId_fkey"
  FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Tenant" ADD COLUMN "businessGroupId" TEXT;
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_businessGroupId_fkey"
  FOREIGN KEY ("businessGroupId") REFERENCES "BusinessGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
