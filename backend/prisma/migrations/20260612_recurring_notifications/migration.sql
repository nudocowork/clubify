-- RecurringNotification para PUSH recurrentes (#1 spec 2026-06-12).
CREATE TABLE IF NOT EXISTS "RecurringNotification" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "cardId" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "segment" JSONB,
  "daysOfWeek" INTEGER[] NOT NULL,
  "timeOfDay" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'America/Bogota',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastDispatchedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecurringNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RecurringNotification_tenantId_isActive_idx"
  ON "RecurringNotification"("tenantId", "isActive");

ALTER TABLE "RecurringNotification"
  ADD CONSTRAINT "RecurringNotification_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecurringNotification"
  ADD CONSTRAINT "RecurringNotification_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "Card"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
