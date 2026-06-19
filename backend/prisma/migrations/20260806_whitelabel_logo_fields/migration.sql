-- WhiteLabel: logos separados por rol
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "iconUrl" TEXT;
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "faviconUrl" TEXT;
