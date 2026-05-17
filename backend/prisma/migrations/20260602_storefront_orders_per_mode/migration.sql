-- Toggle independiente para apagar pedidos solo en la vista delivery.
-- La vista mesa (?mesa=N) siempre va informativa por diseño — el QR
-- de mesa no debe gatillar pedidos. Default true: tenants existentes
-- con ordersEnabled=true mantienen el carrito visible en delivery.
ALTER TABLE "Storefront"
  ADD COLUMN IF NOT EXISTS "ordersDeliveryEnabled" BOOLEAN NOT NULL DEFAULT true;
