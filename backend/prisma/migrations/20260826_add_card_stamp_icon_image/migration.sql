-- Ícono de sello personalizado (imagen PNG/SVG) por tarjeta. Idempotente.
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "stampIconImageUrl" TEXT;
