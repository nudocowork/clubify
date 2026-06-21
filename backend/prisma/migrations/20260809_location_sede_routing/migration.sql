-- Sedes por estado: ruteo de pedidos de domicilio a la sede del estado del cliente
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "ordersWhatsappPhone" TEXT;
