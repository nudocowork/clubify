-- Fase B: monto de delivery en Order (manual desde panel o "acordar
-- con el proveedor" desde menú público). null = no aplica.

ALTER TABLE "Order" ADD COLUMN "deliveryAmount" DECIMAL(10,2);
