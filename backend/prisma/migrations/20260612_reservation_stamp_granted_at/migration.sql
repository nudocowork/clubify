-- Add stampGrantedAt for atomic claim of stamp grant on status=SEATED
ALTER TABLE "Reservation" ADD COLUMN "stampGrantedAt" TIMESTAMP(3);
