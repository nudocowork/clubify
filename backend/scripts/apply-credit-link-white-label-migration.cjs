// Apply migration 20260814_credit_link_white_label to prod Postgres-Nq8w.
// Agrega HotmartCreditLink.whiteLabelId (relacionar cada pack con su marca, que
// comparten productId). Idempotente (ADD COLUMN IF NOT EXISTS).
//
// Usage (desde backend/):
//   railway run --service Postgres-Nq8w node scripts/apply-credit-link-offer-code-migration.cjs
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const MIGRATION = '20260814_credit_link_white_label';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: no DATABASE_PUBLIC_URL ni DATABASE_URL — corré con railway run --service Postgres-Nq8w');
    process.exit(1);
  }
  console.log('Connecting to:', url.replace(/:\/\/[^@]+@/, '://***:***@'));
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const sqlPath = path.join(__dirname, '..', 'prisma', 'migrations', MIGRATION, 'migration.sql');
  const stmts = splitSqlStatements(fs.readFileSync(sqlPath, 'utf8'));
  console.log(`Found ${stmts.length} statements.`);
  let ok = 0, skipped = 0;
  for (const s of stmts) {
    const preview = s.slice(0, 80).replace(/\s+/g, ' ').trim();
    try { await prisma.$executeRawUnsafe(s); console.log(`OK: ${preview}…`); ok++; }
    catch (e) { console.warn(`SKIP (${e.code ?? 'ERR'}): ${preview}… → ${e.message?.split('\n')[0]}`); skipped++; }
  }

  console.log('Recording migration in _prisma_migrations…');
  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM _prisma_migrations WHERE migration_name = '${MIGRATION}' LIMIT 1`,
  );
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'manual-apply-wl-link', NOW(), '${MIGRATION}', 'applied via script', NULL, NOW(), 1)`,
    );
    console.log('Migration row inserted.');
  } else {
    console.log('Migration ya estaba registrada.');
  }

  // Verificación: la columna existe.
  const col = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'HotmartCreditLink' AND column_name = 'whiteLabelId'`,
  );
  console.log(col.length ? '✅ Columna whiteLabelId presente.' : '❌ Columna NO encontrada.');

  console.log(`\nDone — ${ok} OK, ${skipped} skipped.`);
  await prisma.$disconnect();
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });

function splitSqlStatements(sql) {
  const stmts = [];
  let current = '';
  let inDollar = false;
  for (const rawLine of sql.split('\n')) {
    const line = rawLine.replace(/--.*$/, '').trimEnd();
    if (!line.trim()) continue;
    current += line + '\n';
    const dollars = (line.match(/\$\$/g) || []).length;
    if (dollars % 2 === 1) inDollar = !inDollar;
    if (!inDollar && line.trim().endsWith(';')) { stmts.push(current.trim()); current = ''; }
  }
  if (current.trim()) stmts.push(current.trim());
  return stmts;
}
