// Aplica 20260901_add_payout_batch (PayoutBatch + Commission.payoutBatchId +
// paidAtLegacy) y la registra en _prisma_migrations. Todo aditivo/nullable +
// idempotente → sin impacto en filas existentes. Correr ANTES del deploy del
// backend que usa PayoutBatch.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-payout-batch-migration.cjs
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Splitter que respeta el dollar-quoting ($$...$$) de los bloques DO — un
// split ingenuo por ';' partiría los DO $$ ... $$; a la mitad.
function splitSql(sql) {
  const out = [];
  let cur = '';
  let inDollar = false;
  const lines = sql.split('\n');
  for (const raw of lines) {
    const line = raw.replace(/--.*$/, ''); // quita comentarios de línea
    if (line.trim() === '' && !cur.trim()) continue;
    // toggle de $$ (asumimos como máximo un par de $$ relevante por línea/bloque)
    const dollarCount = (line.match(/\$\$/g) || []).length;
    cur += line + '\n';
    if (dollarCount % 2 === 1) inDollar = !inDollar;
    if (!inDollar && cur.trimEnd().endsWith(';')) {
      out.push(cur.trim().replace(/;$/, ''));
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim().replace(/;$/, ''));
  return out.filter(Boolean);
}

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260901_add_payout_batch';

  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'prisma', 'migrations', name, 'migration.sql'), 'utf8');
  const statements = splitSql(sql);
  console.log(`Ejecutando ${statements.length} sentencias…`);
  for (const st of statements) {
    await prisma.$executeRawUnsafe(st);
  }
  console.log(`✅ DDL aplicado.`);

  // Verificación por information_schema.
  const tbl = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_name=$1`, 'PayoutBatch');
  console.log('• Tabla PayoutBatch:', tbl.length ? '✓' : 'FALTA ✗');
  for (const c of ['payoutBatchId', 'paidAtLegacy']) {
    const col = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
      'Commission', c);
    console.log(`• Commission.${c}:`, col.length ? '✓' : 'FALTA ✗');
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
