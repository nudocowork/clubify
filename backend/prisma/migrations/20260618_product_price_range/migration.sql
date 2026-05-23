-- Product: opción de precio por rango (Desde — Hasta). Default FIXED
-- preserva comportamiento legacy. priceMax nullable. Aditivo.

ALTER TABLE "Product" ADD COLUMN "priceMode" TEXT NOT NULL DEFAULT 'FIXED';
ALTER TABLE "Product" ADD COLUMN "priceMax" DECIMAL(10, 2);
