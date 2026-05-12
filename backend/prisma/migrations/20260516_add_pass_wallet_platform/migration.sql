-- Pass.walletPlatform: trackea qué wallet eligió el cliente al instalar
-- (APPLE cuando descarga el .pkpass, GOOGLE cuando pide el save URL).
-- Null = el cliente nunca instaló (ej. solo escaneó para acumular sellos
-- en el panel pero nunca llevó la tarjeta al wallet).
ALTER TABLE "Pass" ADD COLUMN "walletPlatform" "WalletPlatform";
ALTER TABLE "Pass" ADD COLUMN "walletInstalledAt" TIMESTAMP(3);

-- Backfill defensivo: si el pass tiene applePassUrl o googleObjectId
-- seteados de antes de este tracking, asumimos cuál fue. Si tiene los
-- dos (raro), priorizamos APPLE porque applePassUrl solo se setea al
-- generar el .pkpass (que requiere acción del cliente), mientras que
-- googleObjectId se setea al GENERAR el save URL (puede ser preview
-- sin save real).
UPDATE "Pass"
SET
  "walletPlatform" = CASE
    WHEN "applePassUrl" IS NOT NULL THEN 'APPLE'::"WalletPlatform"
    WHEN "googleObjectId" IS NOT NULL THEN 'GOOGLE'::"WalletPlatform"
    ELSE NULL
  END
WHERE "walletPlatform" IS NULL
  AND ("applePassUrl" IS NOT NULL OR "googleObjectId" IS NOT NULL);

CREATE INDEX "Pass_walletPlatform_idx" ON "Pass"("walletPlatform");
