-- Token público para compartir vista de cliente — soyclubify.com/q/<token>.
-- Distinto del id interno: el id no se expone en links.
--
-- Para Quotes existentes hacemos backfill con gen_random_uuid() (pgcrypto
-- ya está habilitado en Postgres ≥ 13). Después del backfill ponemos NOT
-- NULL + UNIQUE.

ALTER TABLE "Quote" ADD COLUMN "publicToken" TEXT;

UPDATE "Quote" SET "publicToken" = gen_random_uuid()::text WHERE "publicToken" IS NULL;

ALTER TABLE "Quote" ALTER COLUMN "publicToken" SET NOT NULL;

CREATE UNIQUE INDEX "Quote_publicToken_key" ON "Quote"("publicToken");
