-- #3: administrador de sede para ruteo de alertas de reseña negativa.
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "adminName" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "adminPhone" TEXT;
