-- Email Marketing (contact-based): base de contactos de la marca.
-- Aditivo + idempotente. Los índices ÚNICOS son PARCIALES (Prisma no los expresa):
--  · phoneNorm único por marca (cierra la carrera del MISMO número; permite São Paulo/Río).
--  · email único por marca.
CREATE TABLE IF NOT EXISTS "MktContact" (
    "id" TEXT NOT NULL,
    "whiteLabelId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "phoneKey" TEXT,
    "phoneNorm" TEXT,
    "company" TEXT,
    "tags" TEXT[],
    "optOut" BOOLEAN NOT NULL DEFAULT false,
    "providerContactId" TEXT,
    "providerLocationId" TEXT,
    "providerSyncedAt" TIMESTAMP(3),
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MktContact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MktContact_whiteLabelId_phoneKey_idx" ON "MktContact"("whiteLabelId", "phoneKey");
CREATE INDEX IF NOT EXISTS "MktContact_whiteLabelId_email_idx" ON "MktContact"("whiteLabelId", "email");
CREATE INDEX IF NOT EXISTS "MktContact_whiteLabelId_deleted_idx" ON "MktContact"("whiteLabelId", "deleted");

CREATE UNIQUE INDEX IF NOT EXISTS "MktContact_wl_phoneNorm_uq"
  ON "MktContact"("whiteLabelId", "phoneNorm")
  WHERE "phoneNorm" IS NOT NULL AND NOT "deleted";

CREATE UNIQUE INDEX IF NOT EXISTS "MktContact_wl_email_uq"
  ON "MktContact"("whiteLabelId", "email")
  WHERE "email" IS NOT NULL AND NOT "deleted";
