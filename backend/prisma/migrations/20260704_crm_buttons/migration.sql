-- C5: botones automáticos del CRM.
-- Cada afiliado configura sus propios botones (decisión confirmada).
-- Action al ejecutar: envío de mensaje (SMS/WHATSAPP/EMAIL/NOTE) +
-- opcional mover stage + opcional agregar tags.

CREATE TYPE "CrmButtonChannel" AS ENUM ('SMS', 'WHATSAPP', 'EMAIL', 'NOTE');

CREATE TABLE "CrmButton" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#6366F1',
  "icon" TEXT,
  "order" INTEGER NOT NULL,
  "channel" "CrmButtonChannel" NOT NULL,
  "messageBody" TEXT,
  "attachmentUrl" TEXT,
  "attachmentName" TEXT,
  "moveToStageId" TEXT,
  "addTags" JSONB NOT NULL DEFAULT '[]',
  "delaySeconds" INTEGER NOT NULL DEFAULT 0,
  "requiresConfirmation" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmButton_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrmButton_ownerUserId_order_idx"
  ON "CrmButton"("ownerUserId", "order");

ALTER TABLE "CrmButton"
  ADD CONSTRAINT "CrmButton_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CrmButton"
  ADD CONSTRAINT "CrmButton_moveToStageId_fkey"
  FOREIGN KEY ("moveToStageId") REFERENCES "Stage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
