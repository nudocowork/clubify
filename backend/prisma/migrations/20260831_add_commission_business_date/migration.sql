-- FECHA DURABLE (2026-08-14): fecha "de negocio" congelada por comisión.
-- Aditiva y nullable → no afecta filas existentes (el read cae a la heurística
-- hasta que el backfill las complete). Idempotente.
ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "businessDate" TIMESTAMP(3);
