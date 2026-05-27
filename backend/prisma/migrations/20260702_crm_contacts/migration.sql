-- C2: tabla CrmContact — contactos/prospectos del CRM por afiliado.
-- Todos los campos textuales opcionales por diseño ("no generar
-- fricción al registrar"). onDelete RESTRICT en stageId para que el
-- service.deleteStage mueva contactos antes de borrar el stage.

CREATE TABLE "CrmContact" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "name" TEXT,
  "phone" TEXT,
  "instagram" TEXT,
  "address" TEXT,
  "description" TEXT,
  "tags" JSONB NOT NULL DEFAULT '[]',
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrmContact_ownerUserId_stageId_idx"
  ON "CrmContact"("ownerUserId", "stageId");
CREATE INDEX "CrmContact_ownerUserId_lastActivityAt_idx"
  ON "CrmContact"("ownerUserId", "lastActivityAt");

ALTER TABLE "CrmContact"
  ADD CONSTRAINT "CrmContact_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CrmContact"
  ADD CONSTRAINT "CrmContact_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "Stage"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
