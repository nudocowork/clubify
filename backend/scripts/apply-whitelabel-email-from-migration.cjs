// Aplica 20260826_add_whitelabel_email_from (ADD COLUMN IF NOT EXISTS) y la
// registra en _prisma_migrations. Idempotente. Correr ANTES de deployar.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-whitelabel-email-from-migration.cjs
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260826_add_whitelabel_email_from';
  const sqlPath = path.join(__dirname, '..', 'prisma', 'migrations', name, 'migration.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const st of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(st);
  }
  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='WhiteLabel' AND column_name='emailFrom'`,
  );
  console.log('• emailFrom presente:', cols.length ? 'sí' : 'NO');
  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name=$1 LIMIT 1`, name,
  );
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count)
       VALUES ($1,$2,$3,now(),now(),1)`, crypto.randomUUID(), 'manual-apply', name,
    );
    console.log('✅ Registrada en _prisma_migrations.');
  } else console.log('• Ya registrada.');
  await prisma.$disconnect();
  console.log('Listo.');
})().catch((e) => { console.error(e); process.exit(1); });
