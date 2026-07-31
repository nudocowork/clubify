-- PDF 1256 §2: liberación de crédito a la marca al suspender un negocio.
-- creditReleasedAt = timestamp de la última liberación (idempotencia). Aditiva.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "creditReleasedAt" TIMESTAMP(3);
