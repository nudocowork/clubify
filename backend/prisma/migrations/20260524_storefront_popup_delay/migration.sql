-- Tiempo configurable antes de mostrar el popup en el menú público.
-- Default 10s para que tenants existentes sigan con el comportamiento anterior.
ALTER TABLE "Storefront" ADD COLUMN IF NOT EXISTS "popupDelaySeconds" INTEGER NOT NULL DEFAULT 10;
