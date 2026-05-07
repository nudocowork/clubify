-- Popup del menú público que aparece a los 10s y lleva a inscripción de tarjeta
ALTER TABLE "Storefront" ADD COLUMN IF NOT EXISTS "popupEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Storefront" ADD COLUMN IF NOT EXISTS "popupImageUrl" TEXT;
ALTER TABLE "Storefront" ADD COLUMN IF NOT EXISTS "popupCardId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Storefront_popupCardId_fkey') THEN
    ALTER TABLE "Storefront" ADD CONSTRAINT "Storefront_popupCardId_fkey"
      FOREIGN KEY ("popupCardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
