-- Cuponera Fase 3: beneficios/promociones + canjes (Benefit, Redemption).

-- CreateEnum
CREATE TYPE "BenefitType" AS ENUM ('PERCENT_OFF', 'AMOUNT_OFF', 'TWO_FOR_ONE', 'FREEBIE', 'PRODUCT', 'OTHER');
CREATE TYPE "BenefitStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');
CREATE TYPE "BenefitApproval" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Benefit" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "allyBusinessId" TEXT NOT NULL,
    "categoryId" TEXT,
    "type" "BenefitType" NOT NULL DEFAULT 'PERCENT_OFF',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "terms" TEXT NOT NULL DEFAULT '',
    "percentOff" INTEGER,
    "amountOffCents" INTEGER,
    "normalPriceCents" INTEGER,
    "memberPriceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "maxPerMember" INTEGER DEFAULT 1,
    "status" "BenefitStatus" NOT NULL DEFAULT 'ACTIVE',
    "approval" "BenefitApproval" NOT NULL DEFAULT 'APPROVED',
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Benefit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Benefit_campaignId_status_approval_idx" ON "Benefit"("campaignId", "status", "approval");
CREATE INDEX "Benefit_allyBusinessId_idx" ON "Benefit"("allyBusinessId");
CREATE INDEX "Benefit_categoryId_idx" ON "Benefit"("categoryId");

-- CreateTable
CREATE TABLE "Redemption" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "benefitId" TEXT NOT NULL,
    "allyBusinessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "passId" TEXT,
    "operatorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Redemption_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Redemption_benefitId_customerId_idx" ON "Redemption"("benefitId", "customerId");
CREATE INDEX "Redemption_allyBusinessId_createdAt_idx" ON "Redemption"("allyBusinessId", "createdAt");
CREATE INDEX "Redemption_campaignId_createdAt_idx" ON "Redemption"("campaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "Benefit" ADD CONSTRAINT "Benefit_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Benefit" ADD CONSTRAINT "Benefit_allyBusinessId_fkey" FOREIGN KEY ("allyBusinessId") REFERENCES "AllyBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Benefit" ADD CONSTRAINT "Benefit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BenefitCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "Benefit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_allyBusinessId_fkey" FOREIGN KEY ("allyBusinessId") REFERENCES "AllyBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
