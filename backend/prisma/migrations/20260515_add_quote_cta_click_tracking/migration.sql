-- CTA click tracking — tercer nivel del funnel (vista → click → conversion).
-- Bumpeado desde el useEffect del signup cuando aterriza con qt=<token>,
-- así medimos clicks que efectivamente llegaron al form (no abandonos en
-- transición). Default 0 para Quotes existentes; los timestamps quedan
-- NULL hasta el primer click. Idempotente con IF NOT EXISTS.

ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "ctaClickCount"     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "firstCtaClickedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "lastCtaClickedAt"  TIMESTAMP(3);
