-- Precio regular antes del descuento (tachado en storefront).
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "originalPrice" DECIMAL(10,2);
