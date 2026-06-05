-- M3 (2026-06-04): pop-ups promocionales en Menú Libro a 3 niveles.
-- Página YA tenía pop-up (en model MenuBookPage). Ahora agregamos:
-- 1) Nivel sección (MenuBookSection)   → dispara al entrar en la sección.
-- 2) Nivel libro / menú (Storefront)   → dispara al abrir /book/<slug>.
-- Casos de uso: producto destacado, oferta limitada, anuncios, promo.
-- Misma shape que MenuBookPage para consistencia (title, description,
-- imageUrl, buttonText, buttonUrl, buttonColor) + delay solo en el global.

ALTER TABLE "MenuBookSection"
  ADD COLUMN "popupEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "popupTitle" TEXT,
  ADD COLUMN "popupDescription" TEXT,
  ADD COLUMN "popupImageUrl" TEXT,
  ADD COLUMN "popupButtonText" TEXT,
  ADD COLUMN "popupButtonUrl" TEXT,
  ADD COLUMN "popupButtonColor" TEXT;

ALTER TABLE "Storefront"
  ADD COLUMN "bookPopupEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "bookPopupTitle" TEXT,
  ADD COLUMN "bookPopupDescription" TEXT,
  ADD COLUMN "bookPopupImageUrl" TEXT,
  ADD COLUMN "bookPopupButtonText" TEXT,
  ADD COLUMN "bookPopupButtonUrl" TEXT,
  ADD COLUMN "bookPopupButtonColor" TEXT,
  ADD COLUMN "bookPopupDelaySeconds" INTEGER NOT NULL DEFAULT 5;
