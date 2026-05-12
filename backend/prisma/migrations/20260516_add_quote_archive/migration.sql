-- Quote archive — el asesor saca cotizaciones viejas/perdidas/duplicadas
-- del listing principal sin borrarlas. NULL = activa; timestamp = archivada.
-- Idempotente con IF NOT EXISTS para Railway.

ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Quote_archivedAt_idx" ON "Quote"("archivedAt");
