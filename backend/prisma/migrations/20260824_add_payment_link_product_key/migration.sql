-- Freemium Sellea: qué otorga un link de pago (INFOLINK_PRO / FULL / null).
-- Aditivo + no-destructivo. Lo aplica el webhook de Stripe según stripePriceId.
ALTER TABLE "WhiteLabelPaymentLink" ADD COLUMN IF NOT EXISTS "productKey" TEXT;
