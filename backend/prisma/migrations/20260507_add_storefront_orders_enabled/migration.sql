-- Toggle informativo vs con carrito en el menú público
ALTER TABLE "Storefront" ADD COLUMN IF NOT EXISTS "ordersEnabled" BOOLEAN NOT NULL DEFAULT true;
