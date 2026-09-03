-- Módulo "Estado del Servidor" (/superadmin): snapshot diario de métricas de
-- infraestructura para calcular crecimiento y proyección de saturación.
-- Idempotente (IF NOT EXISTS). PDF Estado del Servidor 2026-07-30.
CREATE TABLE IF NOT EXISTS "ServerMetricSnapshot" (
  "id"                TEXT NOT NULL,
  "dbSizeBytes"       BIGINT NOT NULL,
  "dbLimitBytes"      BIGINT,
  "tableCount"        INTEGER,
  "connectionsActive" INTEGER,
  "connectionsMax"    INTEGER,
  "memoryRssBytes"    BIGINT,
  "memoryLimitBytes"  BIGINT,
  "storageBytes"      BIGINT,
  "perBrand"          JSONB,
  "source"            TEXT NOT NULL DEFAULT 'cron',
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServerMetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ServerMetricSnapshot_createdAt_idx"
  ON "ServerMetricSnapshot" ("createdAt");
