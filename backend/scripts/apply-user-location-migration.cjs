// Apply migration 20260607_user_location_id a prod Postgres-Nq8w.
//
// Usage (desde backend/):
//   railway run --service Postgres-Nq8w node scripts/apply-user-location-migration.cjs
//
// Idempotente: ADD COLUMN IF NOT EXISTS + DO block para la FK.

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: no DATABASE_PUBLIC_URL ni DATABASE_URL en env');
    console.error('Tip: corré con `railway run --service Postgres-Nq8w node scripts/apply-user-location-migration.cjs`');
    process.exit(1);
  }
  const masked = url.replace(/:\/\/[^@]+@/, '://***:***@');
  console.log('Connecting to:', masked);

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const sqlPath = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260607_user_location_id',
    'migration.sql',
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const stmts = splitSqlStatements(sql);
  console.log(`Found ${stmts.length} statements to run.`);

  let ok = 0;
  let skipped = 0;
  for (const s of stmts) {
    const preview = s.slice(0, 80).replace(/\s+/g, ' ').trim();
    try {
      await prisma.$executeRawUnsafe(s);
      console.log(`OK: ${preview}…`);
      ok += 1;
    } catch (e) {
      console.warn(`SKIP (${e.code ?? 'ERR'}): ${preview}… → ${e.message?.split('\n')[0]}`);
      skipped += 1;
    }
  }

  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM _prisma_migrations
      WHERE migration_name = '20260607_user_location_id' LIMIT 1`,
  );
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES
         (gen_random_uuid()::text,
          'manual-apply-user-location',
          NOW(),
          '20260607_user_location_id',
          'applied via script',
          NULL,
          NOW(),
          1)`,
    );
    console.log('Migration row inserted.');
  } else {
    console.log('Migration ya estaba registrada en _prisma_migrations.');
  }

  console.log(`\nDone — ${ok} OK, ${skipped} skipped.`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});

function splitSqlStatements(sql) {
  const stmts = [];
  let current = '';
  let inDollar = false;
  const lines = sql.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.replace(/--.*$/, '').trimEnd();
    if (!line.trim()) continue;
    current += line + '\n';
    const dollars = (line.match(/\$\$/g) || []).length;
    if (dollars % 2 === 1) inDollar = !inDollar;
    if (!inDollar && line.trim().endsWith(';')) {
      stmts.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) stmts.push(current.trim());
  return stmts;
}
