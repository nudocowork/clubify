-- Estilo configurable del botón "Volver" en la portada de cada sección
-- (layout SECTIONS). NULL = usar el default histórico (negro a 40% +
-- flecha blanca + sombra md + 40px).
ALTER TABLE "Storefront"
  ADD COLUMN IF NOT EXISTS "backButtonConfig" JSONB;
