// Aplica 20260812_whitelabel_maps_key (ADD COLUMN IF NOT EXISTS). Idempotente.
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/apply-whitelabel-maps-key-migration.cjs
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260812_whitelabel_maps_key';
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', name, 'migration.sql'), 'utf8');
  const statements = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
  for (const st of statements) await prisma.$executeRawUnsafe(st);
  console.log(`✅ DDL aplicado (${statements.length} sentencias).`);

  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='WhiteLabel' AND column_name='mapsApiKey'`,
  );
  console.log('• Columna mapsApiKey:', cols.length ? 'OK' : 'FALTA');

  const exists = await prisma.$queryRawUnsafe(`SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1`, name);
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ($1,$2,$3,now(),now(),1)`,
      crypto.randomUUID(), 'manual-apply', name,
    );
    console.log('✅ Registrada en _prisma_migrations.');
  } else console.log('• Ya estaba registrada.');
  await prisma.$disconnect();
  console.log('\nListo.');
})().catch((e) => { console.error(e.message); process.exit(1); });
