-- Cover banner editable para la sección virtual "Recomendados" del menú
-- público (la que agrupa productos con isRecommended=true).
-- NULL en ambas columnas = sin cover custom (fallback default minimal).
ALTER TABLE "Storefront"
  ADD COLUMN IF NOT EXISTS "recommendedTagline" TEXT,
  ADD COLUMN IF NOT EXISTS "recommendedCoverConfig" JSONB;
