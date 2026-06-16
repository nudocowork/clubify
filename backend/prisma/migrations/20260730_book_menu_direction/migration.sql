-- #29 (2026-06-16): orientación del menú libro (HORIZONTAL|VERTICAL).
-- Aditivo, NOT NULL con default → seguro, sin downtime.
ALTER TABLE "Storefront" ADD COLUMN IF NOT EXISTS "bookMenuDirection" TEXT NOT NULL DEFAULT 'HORIZONTAL';
