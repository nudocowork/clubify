-- Flota de motos por empresa de domicilios (PDF245 P1). Aditivo.
CREATE TABLE IF NOT EXISTS "DeliveryVehicle" (
  "id" TEXT NOT NULL,
  "deliveryCompanyId" TEXT NOT NULL,
  "plate" TEXT NOT NULL,
  "driverName" TEXT NOT NULL,
  "driverPhone" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryVehicle_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DeliveryVehicle_deliveryCompanyId_isActive_idx" ON "DeliveryVehicle"("deliveryCompanyId", "isActive");

ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "vehicleId" TEXT;
CREATE INDEX IF NOT EXISTS "Delivery_vehicleId_idx" ON "Delivery"("vehicleId");

ALTER TABLE "DeliveryVehicle"
  ADD CONSTRAINT "DeliveryVehicle_deliveryCompanyId_fkey"
  FOREIGN KEY ("deliveryCompanyId") REFERENCES "DeliveryCompany"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Delivery"
  ADD CONSTRAINT "Delivery_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "DeliveryVehicle"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
