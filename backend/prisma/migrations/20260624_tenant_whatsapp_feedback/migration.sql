-- WhatsApp opcional al cierre del feedback negativo en /r/:slug.
-- enabled=false por default (opt-in); el botón solo aparece cuando el
-- dueño configura número desde su panel.

ALTER TABLE "Tenant" ADD COLUMN "whatsappFeedbackEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "whatsappFeedbackNumber" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "whatsappFeedbackMessage" TEXT;
