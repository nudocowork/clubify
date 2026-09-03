// Aplica 20260902_payout_batch_lifecycle (PayoutBatch.status/periodStart/
// periodEnd/reference/closedAt/closedByUserId/generatedAuto + paymentDate
// nullable) y la registra en _prisma_migrations. Todo aditivo/nullable +
// idempotente. Los cortes que ya existían quedan CLOSED con su fecha real.
// Correr ANTES del deploy del backend que usa los cortes automáticos.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-payout-batch-lifecycle-migration.cjs
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
  const name = '20260902_payout_batch_lifecycle';

  // Foto ANTES (para poder comparar): los cortes existentes y sus totales.
  const before = await prisma.$queryRawUnsafe(
    `SELECT "code", "totalUsd"::text AS total, "paymentDate" FROM "PayoutBatch" ORDER BY "code"`);
  console.log('Cortes existentes ANTES:');
  for (const b of before) console.log(`  • ${b.code}  $${b.total}  pago=${b.paymentDate?.toISOString?.().slice(0, 10) ?? b.paymentDate}`);

  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'prisma', 'migrations', name, 'migration.sql'), 'utf8');
  const statements = splitSql(sql);
  console.log(`\nEjecutando ${statements.length} sentencias…`);
  for (const st of statements) {
    await prisma.$executeRawUnsafe(st);
  }
  console.log('✅ DDL aplicado.');

  // Verificación por information_schema.
  for (const c of ['status', 'periodStart', 'periodEnd', 'reference', 'closedAt', 'closedByUserId', 'generatedAuto']) {
    const col = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
      'PayoutBatch', c);
    console.log(`• PayoutBatch.${c}:`, col.length ? '✓' : 'FALTA ✗');
  }
  const nullable = await prisma.$queryRawUnsafe(
    `SELECT is_nullable FROM information_schema.columns WHERE table_name='PayoutBatch' AND column_name='paymentDate'`);
  console.log('• paymentDate nullable:', nullable[0]?.is_nullable === 'YES' ? '✓' : 'NO ✗');

  // Foto DESPUÉS: los montos NO deben haber cambiado, solo el estado.
  const after = await prisma.$queryRawUnsafe(
    `SELECT "code", "totalUsd"::text AS total, "status"::text AS status, "closedAt" FROM "PayoutBatch" ORDER BY "code"`);
  console.log('\nCortes DESPUÉS:');
  let drift = false;
  for (const a of after) {
    const prev = before.find((b) => b.code === a.code);
    const same = prev && prev.total === a.total;
    if (prev && !same) drift = true;
    console.log(`  • ${a.code}  $${a.total} ${prev ? (same ? '(monto intacto ✓)' : '⚠ MONTO CAMBIÓ') : ''}  estado=${a.status}`);
  }
  if (drift) console.log('⚠️  Un total cambió — revisar antes de seguir.');

  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name=$1 LIMIT 1`, name);
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1,$2,$3,now(),now(),1)`,
      crypto.randomUUID(), 'manual-apply', name);
    console.log('\n✅ Registrada en _prisma_migrations.');
  } else console.log('\n• Ya registrada.');

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
