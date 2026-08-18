-- Motor de email marketing: workflows + carpetas + inscripciones + acciones.
-- Aditivo + idempotente.
CREATE TABLE IF NOT EXISTS "MktWorkflow" (
    "id" TEXT NOT NULL,
    "whiteLabelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "folderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "trigger" JSONB NOT NULL DEFAULT '{}',
    "rootId" TEXT,
    "nodes" JSONB NOT NULL DEFAULT '{}',
    "drip" JSONB NOT NULL DEFAULT '{}',
    "sendWindow" JSONB NOT NULL DEFAULT '{}',
    "reentry" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MktWorkflow_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MktWorkflow_whiteLabelId_status_idx" ON "MktWorkflow"("whiteLabelId", "status");

CREATE TABLE IF NOT EXISTS "MktWorkflowFolder" (
    "id" TEXT NOT NULL,
    "whiteLabelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MktWorkflowFolder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MktWorkflowFolder_whiteLabelId_idx" ON "MktWorkflowFolder"("whiteLabelId");

CREATE TABLE IF NOT EXISTS "MktEnrollment" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "whiteLabelId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentNodeId" TEXT,
    "resumeAt" TIMESTAMP(3),
    "waitKind" TEXT,
    "waitingNodeId" TEXT,
    "waitingSince" TIMESTAMP(3),
    "context" JSONB NOT NULL DEFAULT '{}',
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "MktEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MktEnrollment_status_resumeAt_idx" ON "MktEnrollment"("status", "resumeAt");
CREATE INDEX IF NOT EXISTS "MktEnrollment_workflowId_contactId_idx" ON "MktEnrollment"("workflowId", "contactId");
CREATE INDEX IF NOT EXISTS "MktEnrollment_whiteLabelId_status_idx" ON "MktEnrollment"("whiteLabelId", "status");

CREATE TABLE IF NOT EXISTS "MktAction" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "whiteLabelId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT,
    "body" TEXT,
    "error" TEXT,
    "providerMessageId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "MktAction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MktAction_status_nextAttemptAt_idx" ON "MktAction"("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "MktAction_enrollmentId_nodeId_idx" ON "MktAction"("enrollmentId", "nodeId");
CREATE INDEX IF NOT EXISTS "MktAction_providerMessageId_idx" ON "MktAction"("providerMessageId");
CREATE INDEX IF NOT EXISTS "MktAction_contactId_idx" ON "MktAction"("contactId");
CREATE INDEX IF NOT EXISTS "MktAction_workflowId_createdAt_idx" ON "MktAction"("workflowId", "createdAt");
