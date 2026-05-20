-- Presentations + Slides — F2 del pitch deck system.
-- Cada Presentation pertenece a una Industry (FK CASCADE — si borrás
-- la industria, sus presentaciones se eliminan). Cada Slide pertenece
-- a una Presentation (FK CASCADE — borrar deck borra todas sus slides).
-- slug es único POR industria (no global) para reusar "menu-digital" en
-- varias verticales.

CREATE TYPE "SlideLayout" AS ENUM (
  'COVER',
  'IMAGE_LEFT',
  'IMAGE_RIGHT',
  'FULL_IMAGE',
  'TEXT_ONLY',
  'QUOTE',
  'CTA',
  'STATS',
  'COMPARISON',
  'VIDEO'
);

CREATE TYPE "SlideAnimation" AS ENUM (
  'NONE',
  'FADE',
  'SLIDE_RIGHT',
  'SLIDE_UP',
  'ZOOM'
);

CREATE TABLE "Presentation" (
  "id" TEXT NOT NULL,
  "industryId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "coverImage" TEXT,
  "themeColor" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Presentation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Presentation_industryId_slug_key"
  ON "Presentation"("industryId", "slug");
CREATE INDEX "Presentation_industryId_isActive_sortOrder_idx"
  ON "Presentation"("industryId", "isActive", "sortOrder");

ALTER TABLE "Presentation"
  ADD CONSTRAINT "Presentation_industryId_fkey"
  FOREIGN KEY ("industryId") REFERENCES "Industry"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Slide" (
  "id" TEXT NOT NULL,
  "presentationId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "layout" "SlideLayout" NOT NULL DEFAULT 'COVER',
  "title" TEXT,
  "subtitle" TEXT,
  "body" TEXT,
  "imageUrl" TEXT,
  "videoUrl" TEXT,
  "ctaText" TEXT,
  "ctaUrl" TEXT,
  "bgColor" TEXT,
  "textColor" TEXT,
  "animation" "SlideAnimation" NOT NULL DEFAULT 'NONE',
  "content" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Slide_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Slide_presentationId_sortOrder_idx"
  ON "Slide"("presentationId", "sortOrder");

ALTER TABLE "Slide"
  ADD CONSTRAINT "Slide_presentationId_fkey"
  FOREIGN KEY ("presentationId") REFERENCES "Presentation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
