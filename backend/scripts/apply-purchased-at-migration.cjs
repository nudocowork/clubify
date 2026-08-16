// Aplica 20260830_add_purchased_at_order_sede_idx (ADD COLUMN / CREATE INDEX
// IF NOT EXISTS) y la registra en _prisma_migrations. Correr ANTES del deploy.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-purchased-at-migration.cjs
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260830_add_purchased_at_order_sede_idx';

  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', name, 'migration.sql'), 'utf8');
  const statements = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean);
  for (const st of statements) await prisma.$executeRawUnsafe(st);
  console.log(`✅ DDL aplicado (${statements.length}).`);

  // Verificación: columna nueva + índice.
  const col = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
    'Tenant', 'purchasedAt',
  );
  console.log('• Tenant.purchasedAt:', col.length ? '✓' : 'FALTA ✗');
  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE indexname=$1`,
    'Order_tenantId_locationId_status_idx',
  );
  console.log('• Order(tenantId,locationId,status) idx:', idx.length ? '✓' : 'FALTA ✗');

  const exists = await prisma.$queryRawUnsafe(`SELECT 1 FROM "_prisma_migrations" WHERE migration_name=$1 LIMIT 1`, name);
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1,$2,$3,now(),now(),1)`,
      crypto.randomUUID(), 'manual-apply', name,
    );
    console.log('✅ Registrada en _prisma_migrations.');
  } else console.log('• Ya registrada.');

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
