-- Reembolso manual de créditos (ventana 5 días). Idempotente.
ALTER TABLE "CreditTransaction" ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP(3);
ALTER TABLE "CreditTransaction" ADD COLUMN IF NOT EXISTS "refundWindowNotifiedAt" TIMESTAMP(3);
