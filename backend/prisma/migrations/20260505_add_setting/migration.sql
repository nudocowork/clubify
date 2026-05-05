-- Singleton key/value store para config global de Clubify.
-- Usado para branding (logo del panel + favicon) editable desde super admin.

CREATE TABLE IF NOT EXISTS "Setting" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
