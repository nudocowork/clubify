-- Category cover banner editor: tagline + coverConfig JSON.
-- Backwards compat: NULL en ambas columnas significa "usar fallback
-- legacy" (imageUrl como bg + nombre centrado). Productos y
-- categorías existentes siguen funcionando sin ningún cambio.

ALTER TABLE "Category"
  ADD COLUMN "tagline" TEXT,
  ADD COLUMN "coverConfig" JSONB;
