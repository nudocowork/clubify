-- Knowledge base que entrena al asistente IA del widget de soporte.
-- Manejado por super admin desde /admin/ai-knowledge.
CREATE TABLE "KnowledgeEntry" (
  "id"        TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "content"   TEXT NOT NULL,
  "category"  TEXT NOT NULL DEFAULT 'General',
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KnowledgeEntry_isActive_idx" ON "KnowledgeEntry"("isActive");
