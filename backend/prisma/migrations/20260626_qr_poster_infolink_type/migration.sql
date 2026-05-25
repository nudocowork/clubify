-- Agregar INFOLINK al enum QrPosterType. Va en migration separada porque
-- Postgres no permite usar un nuevo enum value en la misma transacción
-- donde se agrega — la siguiente migration (20260627) ya lo puede usar.
-- IF NOT EXISTS lo hace idempotente.

ALTER TYPE "QrPosterType" ADD VALUE IF NOT EXISTS 'INFOLINK';
