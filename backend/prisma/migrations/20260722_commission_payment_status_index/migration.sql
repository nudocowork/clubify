-- HOTFIX 2026-06-05 (bug #19 ALTA): indexes para los filtros nuevos
-- del panel /admin/commissions y /admin/commissions/payments.
--
-- Sin estos, queries con filtro de paymentStatus o (paymentStatus,createdAt)
-- hacían seq scan completo en Commission. A escala (Hotmart genera 3 rows
-- por sale × N meses) será notablemente lento.
CREATE INDEX IF NOT EXISTS "Commission_paymentStatus_idx"
  ON "Commission" ("paymentStatus");

CREATE INDEX IF NOT EXISTS "Commission_paymentStatus_createdAt_idx"
  ON "Commission" ("paymentStatus", "createdAt");
