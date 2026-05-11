-- Tracking de descargas del PDF de cotización. pdfDownloadCount es proxy
-- de "interés del cliente" — se incrementa cada vez que se baja el PDF
-- desde el panel super admin o desde la vista pública /q/<token>.

ALTER TABLE "Quote"
  ADD COLUMN IF NOT EXISTS "pdfDownloadCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastPdfDownloadAt" TIMESTAMP(3);
