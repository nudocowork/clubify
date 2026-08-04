-- Cross (CrossPay Solutions) como segunda pasarela de pago. Idempotente.

-- 1) Nuevo valor de enum
ALTER TYPE "PaymentGateway" ADD VALUE IF NOT EXISTS 'CROSS';

-- 2) Pago pendiente (flujo pago → datos)
CREATE TABLE IF NOT EXISTS "PendingCrossPayment" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "whiteLabelId" TEXT,
    "providerRef" TEXT,
    "amountUsd" DECIMAL(10,2),
    "currency" TEXT,
    "status" TEXT,
    "rawPayload" JSONB NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PendingCrossPayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PendingCrossPayment_email_idx" ON "PendingCrossPayment"("email");
CREATE INDEX IF NOT EXISTS "PendingCrossPayment_whiteLabelId_idx" ON "PendingCrossPayment"("whiteLabelId");
CREATE INDEX IF NOT EXISTS "PendingCrossPayment_consumedAt_idx" ON "PendingCrossPayment"("consumedAt");

-- 3) Idempotencia de webhooks
CREATE TABLE IF NOT EXISTS "CrossWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "whiteLabelId" TEXT,
    "tenantId" TEXT,
    "status" TEXT,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrossWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CrossWebhookEvent_eventId_key" ON "CrossWebhookEvent"("eventId");
CREATE INDEX IF NOT EXISTS "CrossWebhookEvent_whiteLabelId_processedAt_idx" ON "CrossWebhookEvent"("whiteLabelId", "processedAt");

-- 4) Log / estado de transacciones (panel + auditoría)
CREATE TABLE IF NOT EXISTS "CrossTransaction" (
    "id" TEXT NOT NULL,
    "whiteLabelId" TEXT,
    "tenantId" TEXT,
    "providerRef" TEXT NOT NULL,
    "email" TEXT,
    "amountUsd" DECIMAL(10,2),
    "currency" TEXT,
    "status" TEXT NOT NULL,
    "providerStatus" TEXT,
    "event" TEXT,
    "environment" TEXT,
    "processingMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrossTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CrossTransaction_providerRef_key" ON "CrossTransaction"("providerRef");
CREATE INDEX IF NOT EXISTS "CrossTransaction_whiteLabelId_createdAt_idx" ON "CrossTransaction"("whiteLabelId", "createdAt");
CREATE INDEX IF NOT EXISTS "CrossTransaction_tenantId_idx" ON "CrossTransaction"("tenantId");
