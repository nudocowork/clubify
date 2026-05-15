-- Toggle independiente para mostrar/ocultar el botón de WhatsApp en el
-- menú público sin perder el número (sigue en tenant.whatsappPhone).
-- Default true: tenants existentes mantienen el botón visible.
ALTER TABLE "Storefront"
  ADD COLUMN IF NOT EXISTS "whatsappButtonEnabled" BOOLEAN NOT NULL DEFAULT true;
