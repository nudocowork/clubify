-- Cuponera / Living Card (Fase 1): campañas de beneficios comunitarias.
-- El stack Wallet se reusa vía un Tenant "de sistema" (Tenant.isCampaignHost).

-- CreateEnum
CREATE TYPE "BenefitCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');
CREATE TYPE "MembershipInterval" AS ENUM ('MONTHLY', 'ANNUAL');
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED');
CREATE TYPE "MembershipSource" AS ENUM ('MANUAL', 'MERCADOPAGO');
CREATE TYPE "MembershipOrderStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "isCampaignHost" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BenefitCampaign" (
    "id" TEXT NOT NULL,
    "whiteLabelId" TEXT,
    "tenantId" TEXT NOT NULL,
    "cardId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "BenefitCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "welcomeText" TEXT NOT NULL DEFAULT '',
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BenefitCampaign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BenefitCampaign_tenantId_key" ON "BenefitCampaign"("tenantId");
CREATE UNIQUE INDEX "BenefitCampaign_slug_key" ON "BenefitCampaign"("slug");
CREATE INDEX "BenefitCampaign_whiteLabelId_idx" ON "BenefitCampaign"("whiteLabelId");

-- CreateTable
CREATE TABLE "MembershipPlan" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "interval" "MembershipInterval" NOT NULL DEFAULT 'MONTHLY',
    "benefitsAllowance" INTEGER,
    "description" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "mpPreapprovalPlanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MembershipPlan_campaignId_idx" ON "MembershipPlan"("campaignId");

-- CreateTable
CREATE TABLE "LivingMembership" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "planId" TEXT,
    "status" "MembershipStatus" NOT NULL DEFAULT 'PENDING',
    "source" "MembershipSource" NOT NULL DEFAULT 'MANUAL',
    "memberLevel" INTEGER NOT NULL DEFAULT 0,
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "passId" TEXT,
    "mpPreapprovalId" TEXT,
    "mpPayerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LivingMembership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LivingMembership_campaignId_customerId_key" ON "LivingMembership"("campaignId", "customerId");
CREATE INDEX "LivingMembership_customerId_idx" ON "LivingMembership"("customerId");
CREATE INDEX "LivingMembership_status_idx" ON "LivingMembership"("status");

-- CreateTable
CREATE TABLE "BenefitCategory" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BenefitCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BenefitCategory_campaignId_slug_key" ON "BenefitCategory"("campaignId", "slug");
CREATE INDEX "BenefitCategory_campaignId_idx" ON "BenefitCategory"("campaignId");

-- CreateTable
CREATE TABLE "MembershipOrder" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "planId" TEXT,
    "customerId" TEXT,
    "email" TEXT NOT NULL DEFAULT '',
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "status" "MembershipOrderStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "PaymentGateway" NOT NULL DEFAULT 'MERCADOPAGO',
    "providerRef" TEXT,
    "rawPayload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MembershipOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MembershipOrder_campaignId_idx" ON "MembershipOrder"("campaignId");
CREATE INDEX "MembershipOrder_providerRef_idx" ON "MembershipOrder"("providerRef");

-- CreateTable
CREATE TABLE "MercadopagoWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "campaignId" TEXT,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MercadopagoWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MercadopagoWebhookEvent_eventId_key" ON "MercadopagoWebhookEvent"("eventId");
CREATE INDEX "MercadopagoWebhookEvent_campaignId_eventType_processedAt_idx" ON "MercadopagoWebhookEvent"("campaignId", "eventType", "processedAt");

-- AddForeignKey
ALTER TABLE "BenefitCampaign" ADD CONSTRAINT "BenefitCampaign_whiteLabelId_fkey" FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BenefitCampaign" ADD CONSTRAINT "BenefitCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LivingMembership" ADD CONSTRAINT "LivingMembership_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LivingMembership" ADD CONSTRAINT "LivingMembership_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LivingMembership" ADD CONSTRAINT "LivingMembership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BenefitCategory" ADD CONSTRAINT "BenefitCategory_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipOrder" ADD CONSTRAINT "MembershipOrder_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipOrder" ADD CONSTRAINT "MembershipOrder_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
