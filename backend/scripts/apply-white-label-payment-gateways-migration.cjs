// Aplica la migración 20260810_white_label_payment_gateways a prod de forma
// idempotente (enums con guard, ADD COLUMN/CREATE TABLE IF NOT EXISTS) y la
// registra en _prisma_migrations. Correr ANTES de deployar el backend.
//
// Parser: respeta bloques DO $$ ... $$ (dollar-quoting) — NO parte por ';'
// dentro de ellos, a diferencia del split ingenuo de otros scripts.
//
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/apply-white-label-payment-gateways-migration.cjs
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Divide SQL en sentencias respetando dollar-quoting ($$ ... $$): un ';'
 * dentro de un bloque DO $$ ... $$ NO corta. Scanner char-a-char. Quita
 * líneas de comentario completas (-- ...) antes de escanear.
 */
function splitStatements(sql) {
  const cleaned = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const out = [];
  let buf = '';
  let inDollar = false;
  for (let i = 0; i < cleaned.length; i++) {
    const two = cleaned[i] === '$' && cleaned[i + 1] === '$';
    if (two) {
      inDollar = !inDollar;
      buf += '$$';
      i++; // consumimos el segundo '$'
      continue;
    }
    const ch = cleaned[i];
    if (ch === ';' && !inDollar) {
      const st = buf.trim();
      if (st) out.push(st);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260810_white_label_payment_gateways';

  const sqlPath = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    name,
    'migration.sql',
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = splitStatements(sql);

  for (const st of statements) {
    await prisma.$executeRawUnsafe(st);
  }
  console.log(`✅ DDL aplicado (${statements.length} sentencias, idempotente).`);

  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='WhiteLabel' AND column_name IN ('paymentGateway','paymentConfig') ORDER BY column_name`,
  );
  console.log('• Columnas WhiteLabel:', cols.map((c) => c.column_name).join(', '));

  const tbl = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_name='WhiteLabelPaymentLink' LIMIT 1`,
  );
  console.log('• Tabla WhiteLabelPaymentLink:', tbl.length ? 'OK' : 'FALTA');

  const seeded = await prisma.$queryRawUnsafe(
    `SELECT slug, "paymentGateway" FROM "WhiteLabel" WHERE slug IN ('clubify','sellea') ORDER BY slug`,
  );
  console.log('• Seed pasarelas:', JSON.stringify(seeded));

  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1`,
    name,
  );
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), now(), 1)`,
      crypto.randomUUID(),
      'manual-apply',
      name,
    );
    console.log('✅ Registrada en _prisma_migrations.');
  } else {
    console.log('• Ya estaba registrada en _prisma_migrations.');
  }

  await prisma.$disconnect();
  console.log('\nListo. Ahora sí deployá el backend.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
