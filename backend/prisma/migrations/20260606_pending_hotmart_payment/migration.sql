-- 2026-06-06: flujo "pago → datos" del referido.
--
-- Cuando el cliente paga en Hotmart ANTES de existir la cuenta (porque
-- elige plan → paga → recién entonces llena sus datos en /activar), el
-- webhook PURCHASE_APPROVED/COMPLETE puede llegar antes de que la cuenta
-- se cree. Hoy ese webhook responde `tenant_not_found` y el pago se
-- pierde. Esta tabla guarda esos pagos huérfanos:
--   - El webhook hace INSERT cuando no matchea tenant.
--   - /auth/signup busca por email al crear la cuenta y, si encuentra un
--     pago pendiente, activa el tenant al instante (reusando la lógica
--     del webhook por tenantId) y marca `consumedAt`.
--   - Un job/aviso usa `recoveryNotifiedAt` para mandar SMS/email al
--     comprador que pagó y no volvió a /activar.
--
-- rawPayload guarda el payload completo del webhook para reconstruir la
-- activación sin re-llamar a Hotmart.

CREATE TABLE "PendingHotmartPayment" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "subscriberCode" TEXT,
  "transactionId" TEXT,
  "event" TEXT NOT NULL,
  "rawPayload" JSONB NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "recoveryNotifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PendingHotmartPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingHotmartPayment_email_idx" ON "PendingHotmartPayment"("email");

CREATE INDEX "PendingHotmartPayment_consumedAt_idx" ON "PendingHotmartPayment"("consumedAt");
