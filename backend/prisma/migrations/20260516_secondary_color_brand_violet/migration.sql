-- Alinea el secondaryColor con la marca Clubify (violeta #A855F7) en
-- lugar del fuchsia #C026D3 anterior. Solo cambia el DEFAULT — los
-- tenants existentes que tengan el valor literal #C026D3 se actualizan
-- también para que sus menús + tarjetas wallet se vean alineados con
-- la marca actual.
ALTER TABLE "Tenant" ALTER COLUMN "secondaryColor" SET DEFAULT '#A855F7';
ALTER TABLE "Card" ALTER COLUMN "secondaryColor" SET DEFAULT '#A855F7';

-- Backfill: solo tenants/cards que NUNCA personalizaron (valor literal
-- igual al default viejo). Los que tienen colores custom se respetan.
UPDATE "Tenant" SET "secondaryColor" = '#A855F7' WHERE "secondaryColor" = '#C026D3';
UPDATE "Card" SET "secondaryColor" = '#A855F7' WHERE "secondaryColor" = '#C026D3';
