-- Horarios configurables de reservas por tenant
ALTER TABLE "Tenant" ADD COLUMN "reservationSlots" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
