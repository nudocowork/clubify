-- Storefront: colores configurables del header (logo container, título y
-- descripción). Todos nullable — NULL = default histórico (blanco para
-- logo bg, text-ink para título, text-mute para descripción). Aditivo.

ALTER TABLE "Storefront" ADD COLUMN "logoBgColor" TEXT;
ALTER TABLE "Storefront" ADD COLUMN "titleColor" TEXT;
ALTER TABLE "Storefront" ADD COLUMN "descriptionColor" TEXT;
