-- Flag para marcar productos como "Recomendados" → aparecen en sección
-- virtual arriba del menú público para empujar ventas estratégicamente.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isRecommended" BOOLEAN NOT NULL DEFAULT false;
