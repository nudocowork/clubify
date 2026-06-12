-- User.preferredLocale para i18n foundation.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "preferredLocale" TEXT;
