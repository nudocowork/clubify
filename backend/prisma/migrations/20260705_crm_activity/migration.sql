-- C6: historial completo del contacto (timeline auditable).
-- Cada acción (crear, editar, mover stage, ejecutar botón, agregar
-- nota, agregar tag) genera una CrmActivity. Cascade en contactId y
-- userId — son datos privados del afiliado.

CREATE TYPE "CrmActivityType" AS ENUM (
  'CONTACT_CREATED',
  'CONTACT_UPDATED',
  'STAGE_CHANGED',
  'BUTTON_EXECUTED',
  'NOTE_ADDED',
  'TAG_ADDED'
);

CREATE TABLE "CrmActivity" (
  "id" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "CrmActivityType" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrmActivity_contactId_createdAt_idx"
  ON "CrmActivity"("contactId", "createdAt");

ALTER TABLE "CrmActivity"
  ADD CONSTRAINT "CrmActivity_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CrmActivity"
  ADD CONSTRAINT "CrmActivity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
