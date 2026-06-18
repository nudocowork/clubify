-- Notificaciones SMS de créditos a la marca blanca (Fase 3 follow-up).
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "notifyPhone" TEXT;
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "lowCreditsNotifiedAt" TIMESTAMP(3);
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "pendingClientsNotifiedAt" TIMESTAMP(3);
