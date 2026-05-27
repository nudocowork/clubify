-- B1: vanity URL global para Infolinks.
-- soyclubify.com/<rootSlug> -> infolink directo (en lugar de /i/<tenant>/<link>).
-- Unique global porque vive en la raíz del dominio.

ALTER TABLE "InfoLink" ADD COLUMN "rootSlug" TEXT;
CREATE UNIQUE INDEX "InfoLink_rootSlug_key" ON "InfoLink"("rootSlug");
