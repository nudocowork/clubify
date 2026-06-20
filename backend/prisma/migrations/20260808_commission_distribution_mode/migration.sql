-- Fase 3/4/7 overhaul comisiones: modo de reparto + snapshot + estado ADJUSTMENT
CREATE TYPE "CommissionDistributionMode" AS ENUM ('DISCOUNT_FROM_INFLUENCER', 'ADDITIONAL_COMPANY_COMMISSION');
ALTER TYPE "CommissionStatus" ADD VALUE IF NOT EXISTS 'ADJUSTMENT';
ALTER TABLE "Tenant" ADD COLUMN "commissionDistributionMode" "CommissionDistributionMode" NOT NULL DEFAULT 'DISCOUNT_FROM_INFLUENCER';
ALTER TABLE "Commission" ADD COLUMN "distributionMode" "CommissionDistributionMode";
ALTER TABLE "Commission" ADD COLUMN "baseAmountUsd" DECIMAL(10,2);
ALTER TABLE "Commission" ADD COLUMN "appliedPercent" DECIMAL(5,2);
