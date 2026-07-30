// Migración 20260730000000_add_server_metric_snapshot (módulo "Estado del
// Servidor" en /superadmin): crea la tabla ServerMetricSnapshot — foto diaria
// de métricas de infraestructura (tamaño BD, conexiones, RAM, storage, consumo
// por marca) para calcular CRECIMIENTO y PROYECCIÓN de saturación.
// Idempotente (IF NOT EXISTS). Correr ANTES de deployar el backend nuevo:
//   railway run --service Postgres-Nq8w node scripts/apply-server-metric-snapshot-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260730000000_add_server_metric_snapshot';

  const stmts = [
    `CREATE TABLE IF NOT EXISTS "ServerMetricSnapshot" (
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
     )`,
    `CREATE INDEX IF NOT EXISTS "ServerMetricSnapshot_createdAt_idx"
       ON "ServerMetricSnapshot" ("createdAt")`,
  ];
  for (const s of stmts) await prisma.$executeRawUnsafe(s);
  console.log(`✅ DDL aplicado (tabla + índice, idempotente).`);

  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1`, name,
  );
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), now(), 1)`,
      crypto.randomUUID(), 'manual-apply', name,
    );
    console.log('✅ Registrada en _prisma_migrations.');
  } else {
    console.log('• Ya estaba registrada.');
  }
  await prisma.$disconnect();
  console.log('Listo para deployar el backend.');
})().catch((e) => { console.error(e); process.exit(1); });
