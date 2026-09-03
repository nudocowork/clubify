// READ-ONLY. Detecta drift peligroso: migraciones en el código (prisma/migrations)
// que NO están registradas en _prisma_migrations Y cuyas columnas/tablas NO
// existen en la BD → esas tumban queries (como el outage de isCampaignHost).
// Usage: railway run --service Postgres-Nq8w node backend/scripts/check-pending-migrations.cjs
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const migDir = path.join(__dirname, '..', 'prisma', 'migrations');
  const local = fs
    .readdirSync(migDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const appliedRows = await prisma.$queryRawUnsafe(
    `SELECT migration_name FROM "_prisma_migrations"`,
  );
  const applied = new Set(appliedRows.map((r) => r.migration_name));

  const pending = local.filter((m) => !applied.has(m));
  console.log(`Migraciones locales: ${local.length} · registradas: ${applied.size} · NO registradas: ${pending.length}\n`);

  const colExists = async (table, col) =>
    (await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2 LIMIT 1`,
      table, col,
    )).length > 0;
  const tableExists = async (table) =>
    (await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.tables WHERE table_name=$1 LIMIT 1`,
      table,
    )).length > 0;

  let danger = 0;
  for (const m of pending) {
    const sqlPath = path.join(migDir, m, 'migration.sql');
    let sql = '';
    try { sql = fs.readFileSync(sqlPath, 'utf8'); } catch { /* no sql */ }
    // Extraer targets: ADD COLUMN "x" en ALTER TABLE "T", y CREATE TABLE "T".
    const checks = [];
    const addColRe = /ALTER TABLE\s+"([^"]+)"[\s\S]*?ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/gi;
    let mm;
    while ((mm = addColRe.exec(sql))) checks.push({ kind: 'col', table: mm[1], col: mm[2] });
    const createTblRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/gi;
    while ((mm = createTblRe.exec(sql))) checks.push({ kind: 'tbl', table: mm[1] });

    const missing = [];
    for (const c of checks) {
      if (c.kind === 'col' && !(await colExists(c.table, c.col))) missing.push(`col ${c.table}.${c.col}`);
      if (c.kind === 'tbl' && !(await tableExists(c.table))) missing.push(`tbl ${c.table}`);
    }
    if (missing.length > 0) {
      danger++;
      console.log(`🔴 PENDIENTE + DRIFT: ${m}`);
      console.log(`   Falta en BD: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ` (+${missing.length - 8})` : ''}`);
    } else if (checks.length > 0) {
      console.log(`🟡 No registrada pero ya aplicada (columnas/tablas existen): ${m}`);
    } else {
      console.log(`⚪ No registrada, sin DDL detectable (revisar manual): ${m}`);
    }
  }

  console.log(`\n${danger === 0 ? '✅ Sin drift peligroso: ninguna migración pendiente con columnas/tablas faltantes.' : `🔴 ${danger} migración(es) con DRIFT — aplicar antes de que causen 500.`}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
