-- Chip/fondo detrás del logo (header del pase + preview). null = sin chip
-- (comportamiento histórico). Aditivo, nullable → no afecta tarjetas existentes.
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "logoBgColor" TEXT;
