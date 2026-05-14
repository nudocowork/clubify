-- Fase 1 referidos: slug corto `/ref/<slug>`, tracking de visitas y atribución UTM en ReferralUse.

-- 1. ReferralCode.slug nullable unique
ALTER TABLE "ReferralCode" ADD COLUMN "slug" TEXT;

-- Backfill: cada código existente recibe slug = lowercase(code).
-- Como `code` es unique mayúsculas+dígitos, lowercase también lo es.
UPDATE "ReferralCode" SET "slug" = LOWER("code") WHERE "slug" IS NULL;

CREATE UNIQUE INDEX "ReferralCode_slug_key" ON "ReferralCode"("slug");

-- 2. ReferralUse: atribución (UTM + viaSlug + referer)
ALTER TABLE "ReferralUse" ADD COLUMN "viaSlug" TEXT;
ALTER TABLE "ReferralUse" ADD COLUMN "utmSource" TEXT;
ALTER TABLE "ReferralUse" ADD COLUMN "utmMedium" TEXT;
ALTER TABLE "ReferralUse" ADD COLUMN "utmCampaign" TEXT;
ALTER TABLE "ReferralUse" ADD COLUMN "referer" TEXT;

-- 3. ReferralVisit (eventos de click en `/ref/<slug>`)
CREATE TABLE "ReferralVisit" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "referralCodeId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "country" TEXT,
    "referer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralVisit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReferralVisit_slug_idx" ON "ReferralVisit"("slug");
CREATE INDEX "ReferralVisit_referralCodeId_createdAt_idx" ON "ReferralVisit"("referralCodeId", "createdAt");

ALTER TABLE "ReferralVisit"
  ADD CONSTRAINT "ReferralVisit_referralCodeId_fkey"
  FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
