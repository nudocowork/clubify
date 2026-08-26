-- Visibilidad de la tarjeta "Grow Business · SMS" por marca (solo UI). Aditivo.
-- Default true (no cambia nada existente). Se pone false por marca para ocultarla
-- sin tocar el módulo GROW_BUSINESS_SMS (que gatea el ENVÍO real de SMS).
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "showGrowBusinessCard" BOOLEAN NOT NULL DEFAULT true;

-- Sellea: ocultar la tarjeta (pedido PDF Software 15).
UPDATE "WhiteLabel" SET "showGrowBusinessCard" = false WHERE slug = 'sellea';
