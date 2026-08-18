// Aplica 20260905_add_mkt_engine (MktWorkflow / MktWorkflowFolder / MktEnrollment
// / MktAction + índices) y la registra en _prisma_migrations. Aditivo + idempotente.
// Correr ANTES del deploy del backend que la usa.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-mkt-engine-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260905_add_mkt_engine';

  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'prisma', 'migrations', name, 'migration.sql'),
    'utf8',
  );
  // Ejecuta sentencia por sentencia (split por ';' fuera de comillas es suficiente
  // aquí porque el SQL no contiene ';' dentro de literales).
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(stmt);
  }

  for (const tbl of ['MktWorkflow', 'MktWorkflowFolder', 'MktEnrollment', 'MktAction']) {
    const r = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.tables WHERE table_name=$1`, tbl);
    console.log(`• ${tbl}:`, r.length ? '✓' : 'FALTA ✗');
  }

  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name=$1 LIMIT 1`, name);
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1,$2,$3,now(),now(),1)`,
      crypto.randomUUID(), 'manual-apply', name);
    console.log('✅ Registrada en _prisma_migrations.');
  } else console.log('• Ya registrada.');

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
