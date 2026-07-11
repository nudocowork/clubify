-- Onboarding Sync API — Fase B: token por negocio. Aditivo (tabla nueva aislada).
CREATE TABLE IF NOT EXISTS "OnboardingToken" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'Onboarding',
  "lastFour" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "OnboardingToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnboardingToken_tokenHash_key" ON "OnboardingToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "OnboardingToken_tenantId_idx" ON "OnboardingToken"("tenantId");
