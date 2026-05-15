-- Color de fondo de la página pública del menú (override del default del
-- layout). NULL = usar el default. Pensado especialmente para el layout
-- SECTIONS donde el dueño quiere matchear el fondo con su brand.
ALTER TABLE "Storefront"
  ADD COLUMN IF NOT EXISTS "pageBackgroundColor" TEXT;
