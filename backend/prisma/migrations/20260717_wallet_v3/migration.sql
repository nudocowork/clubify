-- Wallet V3: fondo del área de sellos + Premios Free + auditoría de ajustes + flags por marca

-- Resta manual de sello desde el escáner (-1, piso 0)
ALTER TYPE "StampAction" ADD VALUE IF NOT EXISTS 'STAMP_REMOVE';

-- Card: fondo del área de sellos (independiente del resto del pase) + Premios Free
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "stampBgType" TEXT NOT NULL DEFAULT 'SOLID';
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "stampBgImageUrl" TEXT;
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "freeRewards" JSONB NOT NULL DEFAULT '[]';
-- Opt-in: las tarjetas EXISTENTES conservan su degradado (no cambian de aspecto).
-- Solo las tarjetas nuevas nacen con color uniforme (SOLID).
UPDATE "Card" SET "stampBgType" = 'GRADIENT' WHERE "createdAt" < now();

-- Stamp: auditoría de ajustes manuales (+1/-1) — ip + navegador/dispositivo del operador
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "ip" TEXT;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "device" TEXT;

-- WhiteLabel: bloque "Wallet Avanzado" (permisos por marca; null = heredado/activo)
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "walletAdvanced" JSONB;
