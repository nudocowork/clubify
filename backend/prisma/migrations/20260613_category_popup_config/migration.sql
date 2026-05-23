-- Popup opcional por categoría/sección del menú. JSON nullable —
-- NULL = sin popup (default histórico). Aditivo.

ALTER TABLE "Category" ADD COLUMN "popupConfig" JSONB;
