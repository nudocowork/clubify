-- Periodicidades de plan configurables por marca (form "Nuevo negocio").
-- Default: las 4 (comportamiento Clubify). Cada marca se ajusta en Master Admin.
ALTER TABLE "WhiteLabel"
  ADD COLUMN IF NOT EXISTS "planPeriodicities" TEXT[] NOT NULL
  DEFAULT ARRAY['MENSUAL','TRIMESTRAL','SEMESTRAL','ANUAL']::text[];

-- Sellea: solo Mensual y Anual (pedido del dueño).
UPDATE "WhiteLabel" SET "planPeriodicities" = ARRAY['MENSUAL','ANUAL']::text[]
  WHERE slug = 'sellea';
