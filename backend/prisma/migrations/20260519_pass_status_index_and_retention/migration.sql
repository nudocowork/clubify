-- Pass: índice compuesto para listados del panel. Los queries típicos son
-- "passes ACTIVE del tenant X ordenados por issuedAt DESC" (panel cards) y
-- "passes COMPLETED" (estadísticas). Sin este índice Postgres hace seq scan
-- + sort en memoria en tenants grandes.
CREATE INDEX IF NOT EXISTS "Pass_tenantId_status_issuedAt_idx"
  ON "Pass" ("tenantId", "status", "issuedAt" DESC);
