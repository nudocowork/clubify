-- Industries module — F1 del pitch deck system.
-- Crea sólo la tabla Industry (nivel-1). Presentations + Slides llegan
-- en F2 con sus propias migrations. Sin tocar tablas existentes.

CREATE TABLE "Industry" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "emoji" TEXT,
  "iconUrl" TEXT,
  "coverImage" TEXT,
  "themeColor" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Industry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Industry_name_key" ON "Industry"("name");
CREATE UNIQUE INDEX "Industry_slug_key" ON "Industry"("slug");
CREATE INDEX "Industry_isActive_sortOrder_idx" ON "Industry"("isActive", "sortOrder");
