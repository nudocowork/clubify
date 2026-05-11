-- Engagement tracking de la vista pública /q/<token>. Cada hit del
-- endpoint público incrementa viewCount y actualiza lastViewedAt;
-- firstViewedAt queda fijo en el primer hit. Default 0 para Quotes
-- existentes — los firstViewedAt/lastViewedAt quedan NULL hasta que
-- alguien las vuelva a abrir. Idempotente con IF NOT EXISTS para que
-- la deploy en Railway no se queje si el patch fue aplicado a mano.

ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "viewCount"     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "firstViewedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "lastViewedAt"  TIMESTAMP(3);
