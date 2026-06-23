-- API key de Google Maps por marca blanca (browser key, restringida por
-- referrer). Idempotente.
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "mapsApiKey" TEXT;
