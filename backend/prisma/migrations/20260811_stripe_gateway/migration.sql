-- Stripe live: campos en Tenant + tablas pending/idempotencia. Idempotente.

-- 1) Tenant: customer/subscription de Stripe (match de renovaciones)
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT;
CREATE INDEX IF NOT EXISTS "Tenant_stripeCustomerId_idx" ON "Tenant"("stripeCustomerId");
CREATE INDEX IF NOT EXISTS "Tenant_stripeSubscriptionId_idx" ON "Tenant"("stripeSubscriptionId");

-- 2) Pago Stripe pendiente (flujo pago → datos)
CREATE TABLE IF NOT EXISTS "PendingStripePayment" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "whiteLabelId" TEXT,
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "stripePriceId" TEXT,
  "event" TEXT NOT NULL,
  "rawPayload" JSONB NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "recoveryNotifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PendingStripePayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PendingStripePayment_email_idx" ON "PendingStripePayment"("email");
CREATE INDEX IF NOT EXISTS "PendingStripePayment_whiteLabelId_idx" ON "PendingStripePayment"("whiteLabelId");
CREATE INDEX IF NOT EXISTS "PendingStripePayment_consumedAt_idx" ON "PendingStripePayment"("consumedAt");

-- 3) Idempotencia del webhook Stripe
CREATE TABLE IF NOT EXISTS "StripeWebhookEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "whiteLabelId" TEXT,
  "tenantId" TEXT,
  "payload" JSONB NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StripeWebhookEvent_eventId_key" ON "StripeWebhookEvent"("eventId");
CREATE INDEX IF NOT EXISTS "StripeWebhookEvent_whiteLabelId_eventType_processedAt_idx" ON "StripeWebhookEvent"("whiteLabelId", "eventType", "processedAt");
