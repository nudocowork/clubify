-- Menú visual tipo libro / flipbook por secciones.
-- Aditivo: agrega FLIPBOOK al enum MenuLayout y crea 2 tablas nuevas
-- (MenuBookSection con páginas-imagen + popup inline). El menú clásico
-- por Category/Product sigue funcionando sin cambios.

ALTER TYPE "MenuLayout" ADD VALUE IF NOT EXISTS 'FLIPBOOK';

CREATE TABLE "MenuBookSection" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MenuBookSection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MenuBookSection_tenantId_sortOrder_idx"
  ON "MenuBookSection"("tenantId", "sortOrder");

ALTER TABLE "MenuBookSection"
  ADD CONSTRAINT "MenuBookSection_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MenuBookPage" (
  "id" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "popupEnabled" BOOLEAN NOT NULL DEFAULT false,
  "popupTitle" TEXT,
  "popupDescription" TEXT,
  "popupImageUrl" TEXT,
  "popupButtonText" TEXT,
  "popupButtonUrl" TEXT,
  "popupButtonColor" TEXT,
  CONSTRAINT "MenuBookPage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MenuBookPage_sectionId_sortOrder_idx"
  ON "MenuBookPage"("sectionId", "sortOrder");

ALTER TABLE "MenuBookPage"
  ADD CONSTRAINT "MenuBookPage_sectionId_fkey"
  FOREIGN KEY ("sectionId") REFERENCES "MenuBookSection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
