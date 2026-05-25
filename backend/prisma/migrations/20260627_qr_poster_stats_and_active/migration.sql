-- F6.1 — multi-QR completo: isActive, targetUrl, tracking de scans/descargas.

ALTER TABLE "QrPoster"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "targetUrl" TEXT;

-- Scans del QR público (/q/<id>): cada redirect crea un row acá.
CREATE TABLE "QrPosterVisit" (
    "id" TEXT NOT NULL,
    "posterId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "country" TEXT,
    "referer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QrPosterVisit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QrPosterVisit_posterId_createdAt_idx"
  ON "QrPosterVisit"("posterId", "createdAt");

ALTER TABLE "QrPosterVisit"
  ADD CONSTRAINT "QrPosterVisit_posterId_fkey"
  FOREIGN KEY ("posterId") REFERENCES "QrPoster"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Descargas/exports (PNG/PDF/SVG): cada export crea un row acá.
CREATE TABLE "QrPosterExport" (
    "id" TEXT NOT NULL,
    "posterId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QrPosterExport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QrPosterExport_posterId_createdAt_idx"
  ON "QrPosterExport"("posterId", "createdAt");

ALTER TABLE "QrPosterExport"
  ADD CONSTRAINT "QrPosterExport_posterId_fkey"
  FOREIGN KEY ("posterId") REFERENCES "QrPoster"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
