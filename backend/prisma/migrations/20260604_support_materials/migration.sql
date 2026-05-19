-- Support Material module (sales enablement library para afiliados)
-- Backend: nueva tabla + 2 enums. Sin tocar tablas existentes.
-- FK a ReferralCode con ON DELETE SET NULL para que borrar un influencer
-- no rompa los materiales scoped (quedan globales).

CREATE TYPE "SupportMaterialType" AS ENUM (
  'PDF', 'IMAGE', 'VIDEO', 'AUDIO', 'LINK', 'SCRIPT', 'PRESENTATION', 'TEMPLATE', 'OTHER'
);

CREATE TYPE "SupportMaterialAudience" AS ENUM (
  'INFLUENCER', 'AMBASSADOR', 'BOTH'
);

CREATE TABLE "SupportMaterial" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "type" "SupportMaterialType" NOT NULL,
  "fileUrl" TEXT,
  "externalUrl" TEXT,
  "thumbnailUrl" TEXT,
  "scriptBody" TEXT,
  "category" TEXT NOT NULL DEFAULT 'General',
  "audience" "SupportMaterialAudience" NOT NULL DEFAULT 'BOTH',
  "scopeInfluencerId" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportMaterial_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportMaterial_audience_isActive_idx" ON "SupportMaterial" ("audience", "isActive");
CREATE INDEX "SupportMaterial_category_idx" ON "SupportMaterial" ("category");
CREATE INDEX "SupportMaterial_scopeInfluencerId_idx" ON "SupportMaterial" ("scopeInfluencerId");

ALTER TABLE "SupportMaterial"
  ADD CONSTRAINT "SupportMaterial_scopeInfluencerId_fkey"
  FOREIGN KEY ("scopeInfluencerId") REFERENCES "ReferralCode"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
