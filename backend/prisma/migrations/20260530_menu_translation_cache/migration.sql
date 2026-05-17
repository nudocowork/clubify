-- Fase 2 i18n menú: cache de traducciones del contenido dinámico
-- (categorías, productos, variantes, extras, promos). Una fila por
-- (entidad, campo, locale). `sourceText` es snapshot del texto fuente
-- — si cambia, se invalida y se vuelve a llamar a Claude. `source`
-- distingue traducciones automáticas (Haiku) de overrides manuales
-- del admin (Fase 4).

CREATE TABLE IF NOT EXISTS "MenuTranslation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'auto',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MenuTranslation_tenantId_entityType_entityId_field_locale_key"
  ON "MenuTranslation"("tenantId", "entityType", "entityId", "field", "locale");

CREATE INDEX IF NOT EXISTS "MenuTranslation_tenantId_locale_idx"
  ON "MenuTranslation"("tenantId", "locale");

ALTER TABLE "MenuTranslation"
  ADD CONSTRAINT "MenuTranslation_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
