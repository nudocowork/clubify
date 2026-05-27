-- B2: tipos de fondo del menú (color sólido / gradiente / imagen).
-- pageBackgroundColor existente queda para compat (SOLID).
-- pageBackgroundType=NULL se interpreta como SOLID por el frontend.

ALTER TABLE "Storefront" ADD COLUMN "pageBackgroundType" TEXT;
ALTER TABLE "Storefront" ADD COLUMN "pageBackgroundGradient" TEXT;
ALTER TABLE "Storefront" ADD COLUMN "pageBackgroundImageUrl" TEXT;
