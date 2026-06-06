// Apply multiple pending migrations to production Postgres-Nq8w.
//
// Usage (from ~/Documents/AGENTES/CLUBIFY/backend):
//   railway run --service Postgres-Nq8w node scripts/apply-pending-migration-batch.cjs <migration_name> [...]
//
// Each <migration_name> is a directory under prisma/migrations/. The script
// reads migration.sql, splits into statements, applies them sequentially,
// then records the migration in _prisma_migrations (idempotent via SELECT-first).

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

function splitSqlStatements(sql) {
  // Strip block + line comments
  const noBlockComments = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLineComments = noBlockComments
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

  // Split on `;` but respect dollar-quoted blocks (DO $$ ... $$) and
  // single-quoted strings. Sin esto, los `;` dentro de `DO $$ ... $$`
  // (común en migrations idempotentes con EXCEPTION blocks) cortan al
  // medio una statement y la siguiente queda incompleta.
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDollar = false;
  let i = 0;
  const t = noLineComments;
  while (i < t.length) {
    const ch = t[i];
    const next = t[i + 1];
    if (!inSingleQuote && ch === '$' && next === '$') {
      inDollar = !inDollar;
      current += '$$';
      i += 2;
      continue;
    }
    if (!inDollar && ch === "'") {
      // Escape '' inside single quote = literal quote
      if (inSingleQuote && next === "'") {
        current += "''";
        i += 2;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      current += ch;
      i++;
      continue;
    }
    if (ch === ';' && !inSingleQuote && !inDollar) {
      const stmt = current.trim();
      if (stmt.length > 0) statements.push(stmt);
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  const last = current.trim();
  if (last.length > 0) statements.push(last);
  return statements;
}

(async () => {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node scripts/apply-pending-migration-batch.cjs <migration_name> [...]');
    process.exit(1);
  }

  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: no DATABASE_PUBLIC_URL nor DATABASE_URL in env');
    process.exit(1);
  }
  console.log('Connecting to:', url.replace(/:\/\/[^@]+@/, '://***:***@'));

  const prisma = new PrismaClient({ datasources: { db: { url } } });

  for (const name of args) {
    const sqlPath = path.resolve(__dirname, '..', 'prisma', 'migrations', name, 'migration.sql');
    if (!fs.existsSync(sqlPath)) {
      console.error(`SKIP ${name}: ${sqlPath} not found`);
      continue;
    }
    console.log(`\n>>> ${name}`);
    const alreadyApplied = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM _prisma_migrations WHERE migration_name = $1 LIMIT 1`,
      name,
    );
    if (alreadyApplied.length > 0) {
      console.log(`  (already in _prisma_migrations — skip apply, no-op)`);
      continue;
    }

    const sql = fs.readFileSync(sqlPath, 'utf-8');
    const statements = splitSqlStatements(sql);
    console.log(`  ${statements.length} statements`);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      const preview = stmt.replace(/\s+/g, ' ').slice(0, 80);
      console.log(`  [${i + 1}/${statements.length}] ${preview}…`);
      await prisma.$executeRawUnsafe(stmt);
    }

    console.log(`  Recording in _prisma_migrations…`);
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES
         (gen_random_uuid()::text, $1, NOW(), $2, NULL, NULL, NOW(), 1)`,
      `manual-batch-${name}`,
      name,
    );
    console.log(`  ✓ ${name} applied`);
  }

  await prisma.$disconnect();
  console.log('\nDone.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
