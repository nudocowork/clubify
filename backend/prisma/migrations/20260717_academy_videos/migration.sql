-- Academia interactiva: video-tutorial (YouTube) por módulo y por marca blanca.
CREATE TABLE IF NOT EXISTS "AcademyVideo" (
  "id" TEXT NOT NULL,
  "whiteLabelId" TEXT NOT NULL,
  "moduleKey" TEXT NOT NULL,
  "youtubeUrl" TEXT NOT NULL DEFAULT '',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "title" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AcademyVideo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AcademyVideo_whiteLabelId_moduleKey_key" ON "AcademyVideo"("whiteLabelId", "moduleKey");
CREATE INDEX IF NOT EXISTS "AcademyVideo_whiteLabelId_idx" ON "AcademyVideo"("whiteLabelId");
ALTER TABLE "AcademyVideo"
  ADD CONSTRAINT "AcademyVideo_whiteLabelId_fkey"
  FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
