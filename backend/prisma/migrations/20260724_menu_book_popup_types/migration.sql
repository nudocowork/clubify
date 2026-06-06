-- M9 (2026-06-06): popups del Menú Libro con discriminator `type`.
-- Hoy solo soporta link externo. Ahora 3 modos mutuamente excluyentes:
--   - EXTERNAL_LINK (default + back compat): buttonUrl + buttonText.
--   - CARD: cardId apunta a una Card del tenant. Front redirige al enroll
--     /c/<cardId>. cardCtaLabel customiza el CTA.
--   - IMAGE: solo visualización (imageUrl + imageCaption opcional, sin CTA).
-- Popups existentes quedan con popupType NULL → el front lo interpreta como
-- EXTERNAL_LINK (back compat).
--
-- FKs apuntan a Card con ON DELETE SET NULL para que borrar una Card no
-- rompa los popups; quedan "huérfanos" del CTA pero el resto sigue vivo.

ALTER TABLE "Storefront"
  ADD COLUMN "bookPopupType" TEXT,
  ADD COLUMN "bookPopupCardId" TEXT,
  ADD COLUMN "bookPopupCardCtaLabel" TEXT,
  ADD COLUMN "bookPopupImageCaption" TEXT;

ALTER TABLE "Storefront"
  ADD CONSTRAINT "Storefront_bookPopupCardId_fkey"
  FOREIGN KEY ("bookPopupCardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MenuBookSection"
  ADD COLUMN "popupType" TEXT,
  ADD COLUMN "popupCardId" TEXT,
  ADD COLUMN "popupCardCtaLabel" TEXT,
  ADD COLUMN "popupImageCaption" TEXT;

ALTER TABLE "MenuBookSection"
  ADD CONSTRAINT "MenuBookSection_popupCardId_fkey"
  FOREIGN KEY ("popupCardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MenuBookPage"
  ADD COLUMN "popupType" TEXT,
  ADD COLUMN "popupCardId" TEXT,
  ADD COLUMN "popupCardCtaLabel" TEXT,
  ADD COLUMN "popupImageCaption" TEXT;

ALTER TABLE "MenuBookPage"
  ADD CONSTRAINT "MenuBookPage_popupCardId_fkey"
  FOREIGN KEY ("popupCardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
