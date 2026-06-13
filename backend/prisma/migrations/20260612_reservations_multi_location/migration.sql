-- Multi-sede en reservas (2026-06-12)
ALTER TABLE "ReservationZone" ADD COLUMN "locationId" TEXT;
ALTER TABLE "ReservationTable" ADD COLUMN "locationId" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "locationId" TEXT;

CREATE INDEX "ReservationZone_locationId_idx" ON "ReservationZone"("locationId");
CREATE INDEX "ReservationTable_locationId_idx" ON "ReservationTable"("locationId");
CREATE INDEX "Reservation_locationId_date_idx" ON "Reservation"("locationId", "date");

ALTER TABLE "ReservationZone" ADD CONSTRAINT "ReservationZone_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
