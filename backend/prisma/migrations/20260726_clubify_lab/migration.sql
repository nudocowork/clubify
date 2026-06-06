-- Clubify Lab (item 13 sprint): sistema de propuestas de comunidad.
-- Clientes/embajadores/influencers/vendedores proponen mejoras → equipo
-- Clubify revisa → propuestas aprobadas pasan a votación pública → las
-- más votadas entran al roadmap.

-- ============ ENUMS ============

CREATE TYPE "LabCategory" AS ENUM (
  'CLIENTS',
  'AFFILIATES'
);

CREATE TYPE "LabPriority" AS ENUM (
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
);

CREATE TYPE "LabStatus" AS ENUM (
  'PENDING',
  'REJECTED',
  'EVALUATING',
  'APPROVED',
  'IN_DEVELOPMENT',
  'IN_TESTING',
  'IMPLEMENTED'
);

CREATE TYPE "LabVoteKind" AS ENUM (
  'LIKE',
  'NEED',
  'HIGH_PRIORITY',
  'DISLIKE'
);

-- ============ TABLES ============

CREATE TABLE "LabProposal" (
  "id"                    TEXT NOT NULL,
  "title"                 TEXT NOT NULL,
  "description"           TEXT NOT NULL,
  "category"              "LabCategory" NOT NULL,
  "priority"              "LabPriority" NOT NULL DEFAULT 'MEDIUM',
  "expectedBenefit"       TEXT,
  "status"                "LabStatus" NOT NULL DEFAULT 'PENDING',
  "attachmentUrl"         TEXT,
  "attachmentKind"        TEXT,
  "authorId"              TEXT NOT NULL,
  "rejectionReason"       TEXT,
  "votesScore"            INTEGER NOT NULL DEFAULT 0,
  "votesCount"            INTEGER NOT NULL DEFAULT 0,
  "commentsCount"         INTEGER NOT NULL DEFAULT 0,
  "lastStatusChangedById" TEXT,
  "lastStatusChangedAt"   TIMESTAMP(3),
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LabProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LabProposal_category_status_votesScore_idx"
  ON "LabProposal"("category", "status", "votesScore");

CREATE INDEX "LabProposal_authorId_idx"
  ON "LabProposal"("authorId");

ALTER TABLE "LabProposal"
  ADD CONSTRAINT "LabProposal_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LabProposal"
  ADD CONSTRAINT "LabProposal_lastStatusChangedById_fkey"
  FOREIGN KEY ("lastStatusChangedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LabVote" (
  "id"         TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "kind"       "LabVoteKind" NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LabVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LabVote_proposalId_userId_key"
  ON "LabVote"("proposalId", "userId");

CREATE INDEX "LabVote_proposalId_kind_idx"
  ON "LabVote"("proposalId", "kind");

ALTER TABLE "LabVote"
  ADD CONSTRAINT "LabVote_proposalId_fkey"
  FOREIGN KEY ("proposalId") REFERENCES "LabProposal"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LabVote"
  ADD CONSTRAINT "LabVote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LabComment" (
  "id"         TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "authorId"   TEXT NOT NULL,
  "body"       TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LabComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LabComment_proposalId_createdAt_idx"
  ON "LabComment"("proposalId", "createdAt");

ALTER TABLE "LabComment"
  ADD CONSTRAINT "LabComment_proposalId_fkey"
  FOREIGN KEY ("proposalId") REFERENCES "LabProposal"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LabComment"
  ADD CONSTRAINT "LabComment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
