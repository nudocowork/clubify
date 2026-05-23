-- Estilo visual del banner de portada de Industry. 5 variantes que el
-- admin elige desde el picker. Aditivo y reversible.

CREATE TYPE "IndustryCoverStyle" AS ENUM (
  'DARK_OVERLAY',
  'GRADIENT_BRAND',
  'BLUR_GLASS',
  'MINIMAL',
  'MODERN_SPLIT'
);

ALTER TABLE "Industry"
  ADD COLUMN "coverStyle" "IndustryCoverStyle" NOT NULL DEFAULT 'DARK_OVERLAY';
