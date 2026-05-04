-- Grow Business (SMS provider) connection per tenant
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "growBusinessLocationId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "growBusinessApiKey" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "growBusinessConnectedAt" TIMESTAMP(3);
