-- Fase B (PDF734): workflows multipaso por tenant + inscripciones de clientes.
CREATE TABLE IF NOT EXISTS "AutomationWorkflow" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "triggerType" TEXT NOT NULL,
  "triggerDays" INTEGER,
  "steps" JSONB NOT NULL DEFAULT '[]',
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "stats" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationWorkflow_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AutomationWorkflow_tenantId_isActive_idx" ON "AutomationWorkflow"("tenantId", "isActive");

CREATE TABLE IF NOT EXISTS "AutomationEnrollment" (
  "id" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "stepIndex" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationEnrollment_workflowId_customerId_key" ON "AutomationEnrollment"("workflowId", "customerId");
CREATE INDEX IF NOT EXISTS "AutomationEnrollment_status_nextRunAt_idx" ON "AutomationEnrollment"("status", "nextRunAt");
CREATE INDEX IF NOT EXISTS "AutomationEnrollment_tenantId_idx" ON "AutomationEnrollment"("tenantId");

ALTER TABLE "AutomationEnrollment"
  ADD CONSTRAINT "AutomationEnrollment_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "AutomationWorkflow"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
