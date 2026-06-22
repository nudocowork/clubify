-- Pasarelas de pago por marca blanca (Hotmart / Stripe / Manual).
-- Idempotente: usa guards para correr también vía apply-script en prod.

-- 1) Enums (CREATE TYPE no soporta IF NOT EXISTS → guard con DO block)
DO $$ BEGIN
  CREATE TYPE "PaymentGateway" AS ENUM ('HOTMART', 'STRIPE', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentLinkPeriodicity" AS ENUM ('MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Campos nuevos en WhiteLabel
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "paymentGateway" "PaymentGateway" NOT NULL DEFAULT 'HOTMART';
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "paymentConfig" JSONB;

-- 3) Tabla de links de pago por marca
CREATE TABLE IF NOT EXISTS "WhiteLabelPaymentLink" (
  "id" TEXT NOT NULL,
  "whiteLabelId" TEXT NOT NULL,
  "gateway" "PaymentGateway" NOT NULL,
  "name" TEXT NOT NULL,
  "periodicity" "PaymentLinkPeriodicity" NOT NULL DEFAULT 'MENSUAL',
  "amountUsd" DECIMAL(10,2) NOT NULL,
  "url" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "stripePriceId" TEXT,
  "stripeProductId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhiteLabelPaymentLink_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WhiteLabelPaymentLink_whiteLabelId_idx" ON "WhiteLabelPaymentLink"("whiteLabelId");
CREATE INDEX IF NOT EXISTS "WhiteLabelPaymentLink_stripePriceId_idx" ON "WhiteLabelPaymentLink"("stripePriceId");

DO $$ BEGIN
  ALTER TABLE "WhiteLabelPaymentLink" ADD CONSTRAINT "WhiteLabelPaymentLink_whiteLabelId_fkey"
    FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4) Seed: Clubify cobra con Hotmart (default ya aplica), Sellea con Stripe.
UPDATE "WhiteLabel" SET "paymentGateway" = 'STRIPE' WHERE "slug" = 'sellea';
