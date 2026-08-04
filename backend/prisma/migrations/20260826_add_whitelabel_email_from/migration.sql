-- Remitente de emails transaccionales por marca (ej "Sellea <hola@selleala.com>").
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "emailFrom" TEXT;
