-- Páginas informativas globales de plataforma (soyclubify.com/informacion*)
-- + captación de leads. Ver InfoPage / InfoPageLead en schema.prisma.

CREATE TABLE IF NOT EXISTS "InfoPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "logoUrl" TEXT,
    "heroImageUrl" TEXT,
    "videoUrl" TEXT,
    "description" TEXT,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "ctaText" TEXT,
    "ctaUrl" TEXT,
    "formEnabled" BOOLEAN NOT NULL DEFAULT true,
    "formFields" JSONB NOT NULL DEFAULT '[]',
    "theme" JSONB NOT NULL DEFAULT '{}',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InfoPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InfoPage_slug_key" ON "InfoPage"("slug");

CREATE TABLE IF NOT EXISTS "InfoPageLead" (
    "id" TEXT NOT NULL,
    "infoPageId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "tag" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InfoPageLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "InfoPageLead_infoPageId_createdAt_idx" ON "InfoPageLead"("infoPageId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "InfoPageLead" ADD CONSTRAINT "InfoPageLead_infoPageId_fkey"
        FOREIGN KEY ("infoPageId") REFERENCES "InfoPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
