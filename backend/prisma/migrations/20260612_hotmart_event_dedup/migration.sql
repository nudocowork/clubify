-- E (2026-06-12): tabla HotmartWebhookEvent para event-level idempotency
-- + Tenant.lastChargeAt para reportes.

ALTER TABLE "Tenant"
  ADD COLUMN "lastChargeAt" TIMESTAMP(3);

CREATE TABLE "HotmartWebhookEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "tenantId" TEXT,
  "payload" JSONB NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HotmartWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HotmartWebhookEvent_eventId_key"
  ON "HotmartWebhookEvent"("eventId");

CREATE INDEX "HotmartWebhookEvent_tenantId_eventType_processedAt_idx"
  ON "HotmartWebhookEvent"("tenantId", "eventType", "processedAt");
