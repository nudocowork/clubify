-- Fase 5 IA: documentos subidos por admin + audience filter + embeddings
-- como JSON. Sin pgvector por ahora — el retrieval es lexical (audience-
-- filtered concat) o in-memory cosine sobre Float[] cuando hay embeddings.

-- 1. Enums
DO $$ BEGIN
  CREATE TYPE "KnowledgeAudience" AS ENUM ('TENANT', 'AFFILIATE', 'BOTH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. KnowledgeDocument (nueva tabla)
CREATE TABLE IF NOT EXISTS "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER,
    "audience" "KnowledgeAudience" NOT NULL DEFAULT 'BOTH',
    "category" TEXT NOT NULL DEFAULT 'General',
    "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "totalChars" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KnowledgeDocument_status_idx" ON "KnowledgeDocument"("status");
CREATE INDEX IF NOT EXISTS "KnowledgeDocument_audience_idx" ON "KnowledgeDocument"("audience");

-- 3. KnowledgeEntry: agrega columnas para audience, document chunks y embeddings
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "audience" "KnowledgeAudience" NOT NULL DEFAULT 'BOTH';
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "documentId" TEXT;
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "chunkIndex" INTEGER;
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "embedding" JSONB;
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "embeddingModel" TEXT;
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "tokenCount" INTEGER;

-- 4. FK + indexes nuevos
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'KnowledgeEntry_documentId_fkey'
  ) THEN
    ALTER TABLE "KnowledgeEntry"
      ADD CONSTRAINT "KnowledgeEntry_documentId_fkey"
      FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- El índice viejo (isActive solo) lo reemplazamos por uno compuesto con audience.
DROP INDEX IF EXISTS "KnowledgeEntry_isActive_idx";
CREATE INDEX IF NOT EXISTS "KnowledgeEntry_isActive_audience_idx" ON "KnowledgeEntry"("isActive", "audience");
CREATE INDEX IF NOT EXISTS "KnowledgeEntry_documentId_idx" ON "KnowledgeEntry"("documentId");
