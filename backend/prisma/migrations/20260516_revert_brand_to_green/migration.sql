-- Revertir defaults de brand color de indigo (#6366F1 / #A855F7) al
-- verde Clubify oficial (#22C55E / #15803D). Los defaults solo aplican
-- a INSERTs futuros — no actualizamos rows existentes (cada tenant /
-- card mantiene la paleta que ya eligió).

ALTER TABLE "Tenant" ALTER COLUMN "primaryColor"   SET DEFAULT '#22C55E';
ALTER TABLE "Tenant" ALTER COLUMN "secondaryColor" SET DEFAULT '#15803D';

ALTER TABLE "Card" ALTER COLUMN "primaryColor"   SET DEFAULT '#22C55E';
ALTER TABLE "Card" ALTER COLUMN "secondaryColor" SET DEFAULT '#15803D';
