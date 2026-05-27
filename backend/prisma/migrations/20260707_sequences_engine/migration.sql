-- F2: Secuencias / Automatizaciones (Sequences engine).
-- Workflows tipo GHL/ActiveCampaign donde el afiliado define una
-- secuencia de pasos y los contactos se enrollan vía trigger (manual,
-- CONTACT_CREATED, STAGE_CHANGED, TAG_ADDED, CONTACT_FROM_GB) y el
-- engine ejecuta paso por paso con delay vía BullMQ.

-- ============ ENUMS ============

CREATE TYPE "SequenceTriggerKind" AS ENUM (
  'MANUAL',
  'CONTACT_CREATED',
  'STAGE_CHANGED',
  'TAG_ADDED',
  'CONTACT_FROM_GB'
);

CREATE TYPE "SequenceStepKind" AS ENUM (
  'SEND_MESSAGE',
  'WAIT',
  'MOVE_STAGE',
  'ADD_TAG',
  'REMOVE_TAG',
  'ASSIGN_USER',
  'END'
);

CREATE TYPE "SequenceMessageType" AS ENUM (
  'TEXT',
  'AUDIO',
  'VIDEO',
  'PDF',
  'IMAGE'
);

CREATE TYPE "SequenceMessageChannel" AS ENUM (
  'SMS',
  'WHATSAPP'
);

CREATE TYPE "SequenceWaitUnit" AS ENUM (
  'MINUTES',
  'HOURS',
  'DAYS',
  'WEEKS'
);

CREATE TYPE "SequenceEnrollmentStatus" AS ENUM (
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'CANCELED',
  'FAILED'
);

-- ============ TABLES ============

CREATE TABLE "Sequence" (
  "id"          TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Sequence_ownerUserId_isActive_idx"
  ON "Sequence"("ownerUserId", "isActive");

ALTER TABLE "Sequence"
  ADD CONSTRAINT "Sequence_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SequenceStep" (
  "id"             TEXT NOT NULL,
  "sequenceId"     TEXT NOT NULL,
  "order"          INTEGER NOT NULL,
  "kind"           "SequenceStepKind" NOT NULL,
  "messageChannel" "SequenceMessageChannel",
  "messageType"    "SequenceMessageType",
  "messageBody"    TEXT,
  "attachmentUrl"  TEXT,
  "attachmentName" TEXT,
  "waitAmount"     INTEGER,
  "waitUnit"       "SequenceWaitUnit",
  "moveToStageId"  TEXT,
  "tags"           JSONB NOT NULL DEFAULT '[]'::jsonb,
  "assignToUserId" TEXT,
  "nodeX"          DOUBLE PRECISION,
  "nodeY"          DOUBLE PRECISION,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SequenceStep_sequenceId_order_idx"
  ON "SequenceStep"("sequenceId", "order");

ALTER TABLE "SequenceStep"
  ADD CONSTRAINT "SequenceStep_sequenceId_fkey"
  FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SequenceStep"
  ADD CONSTRAINT "SequenceStep_moveToStageId_fkey"
  FOREIGN KEY ("moveToStageId") REFERENCES "Stage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SequenceStep"
  ADD CONSTRAINT "SequenceStep_assignToUserId_fkey"
  FOREIGN KEY ("assignToUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SequenceTrigger" (
  "id"         TEXT NOT NULL,
  "sequenceId" TEXT NOT NULL,
  "kind"       "SequenceTriggerKind" NOT NULL,
  "config"     JSONB NOT NULL DEFAULT '{}'::jsonb,
  "isActive"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SequenceTrigger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SequenceTrigger_sequenceId_idx"
  ON "SequenceTrigger"("sequenceId");

CREATE INDEX "SequenceTrigger_kind_isActive_idx"
  ON "SequenceTrigger"("kind", "isActive");

ALTER TABLE "SequenceTrigger"
  ADD CONSTRAINT "SequenceTrigger_sequenceId_fkey"
  FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SequenceEnrollment" (
  "id"            TEXT NOT NULL,
  "sequenceId"    TEXT NOT NULL,
  "contactId"     TEXT NOT NULL,
  "status"        "SequenceEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "currentStepId" TEXT,
  "nextRunAt"     TIMESTAMP(3),
  "jobId"         TEXT,
  "triggerKind"   "SequenceTriggerKind" NOT NULL DEFAULT 'MANUAL',
  "lastError"     TEXT,
  "enrolledAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"   TIMESTAMP(3),
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SequenceEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SequenceEnrollment_contactId_idx"
  ON "SequenceEnrollment"("contactId");

CREATE INDEX "SequenceEnrollment_status_nextRunAt_idx"
  ON "SequenceEnrollment"("status", "nextRunAt");

CREATE INDEX "SequenceEnrollment_sequenceId_status_idx"
  ON "SequenceEnrollment"("sequenceId", "status");

ALTER TABLE "SequenceEnrollment"
  ADD CONSTRAINT "SequenceEnrollment_sequenceId_fkey"
  FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SequenceEnrollment"
  ADD CONSTRAINT "SequenceEnrollment_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SequenceEnrollment"
  ADD CONSTRAINT "SequenceEnrollment_currentStepId_fkey"
  FOREIGN KEY ("currentStepId") REFERENCES "SequenceStep"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SequenceExecution" (
  "id"           TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "stepId"       TEXT NOT NULL,
  "stepKind"     "SequenceStepKind" NOT NULL,
  "status"       TEXT NOT NULL,
  "message"      TEXT,
  "error"        TEXT,
  "metadata"     JSONB NOT NULL DEFAULT '{}'::jsonb,
  "executedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SequenceExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SequenceExecution_enrollmentId_executedAt_idx"
  ON "SequenceExecution"("enrollmentId", "executedAt");

ALTER TABLE "SequenceExecution"
  ADD CONSTRAINT "SequenceExecution_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "SequenceEnrollment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
