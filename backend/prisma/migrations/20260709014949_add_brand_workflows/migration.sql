-- Workflows de marca blanca (panel /admin/automatizaciones): motor durable por @Cron.

CREATE TABLE "BrandWorkflow" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrandWorkflow_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BrandWorkflow_whiteLabelId_status_idx" ON "BrandWorkflow"("whiteLabelId", "status");

CREATE TABLE "BrandWorkflowFolder" (
    "id" TEXT NOT NULL,
    "whiteLabelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrandWorkflowFolder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BrandWorkflowFolder_whiteLabelId_idx" ON "BrandWorkflowFolder"("whiteLabelId");

CREATE TABLE "BrandWorkflowEnrollment" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentNodeId" TEXT,
    "resumeAt" TIMESTAMP(3),
    "waitKind" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "BrandWorkflowEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BrandWorkflowEnrollment_status_resumeAt_idx" ON "BrandWorkflowEnrollment"("status", "resumeAt");
CREATE INDEX "BrandWorkflowEnrollment_workflowId_tenantId_idx" ON "BrandWorkflowEnrollment"("workflowId", "tenantId");

CREATE TABLE "BrandWorkflowLog" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "whiteLabelId" TEXT NOT NULL,
    "tenantId" TEXT,
    "nodeId" TEXT,
    "nodeType" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrandWorkflowLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BrandWorkflowLog_workflowId_createdAt_idx" ON "BrandWorkflowLog"("workflowId", "createdAt");
