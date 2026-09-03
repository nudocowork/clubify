-- WhiteLabel.whatsappQrUrl: enlace de conexión de WhatsApp de la marca (ej.
-- proveedor tipo wazzap.mx). El super admin lo pega en /superadmin y el panel
-- /admin de la marca genera un QR con él (Automatizaciones → QR WhatsApp).
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "whatsappQrUrl" TEXT;
