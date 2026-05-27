-- C1: CRM kanban — Pipeline + Stage por afiliado.
-- Auto-creación del pipeline default (5 stages: Contactos/Interesados/
-- Seguimiento/Cliente/No interesado) la hace el backend al primer
-- GET /crm/pipeline — la migration solo crea las tablas vacías.

CREATE TYPE "StageKind" AS ENUM (
  'CONTACTS',
  'INTERESTED',
  'FOLLOWUP',
  'CLIENT',
  'NOT_INTERESTED',
  'CUSTOM'
);

CREATE TABLE "Pipeline" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Mi pipeline',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Pipeline_ownerUserId_key" ON "Pipeline"("ownerUserId");

ALTER TABLE "Pipeline"
  ADD CONSTRAINT "Pipeline_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Stage" (
  "id" TEXT NOT NULL,
  "pipelineId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#94A3B8',
  "order" INTEGER NOT NULL,
  "kind" "StageKind" NOT NULL DEFAULT 'CUSTOM',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Stage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Stage_pipelineId_order_idx" ON "Stage"("pipelineId", "order");

ALTER TABLE "Stage"
  ADD CONSTRAINT "Stage_pipelineId_fkey"
  FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
