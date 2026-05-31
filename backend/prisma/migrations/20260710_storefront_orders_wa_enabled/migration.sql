-- Fase C: toggle del botón "pedir por WhatsApp" en delivery. Mesa
-- siempre informativo (sin WA) — esta flag solo aplica a delivery.

ALTER TABLE "Storefront" ADD COLUMN "ordersWhatsappEnabled" BOOLEAN NOT NULL DEFAULT true;
