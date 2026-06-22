// Aplica la migración 20260811_stripe_gateway a prod de forma idempotente
// (ADD COLUMN/CREATE TABLE IF NOT EXISTS) y la registra en _prisma_migrations.
// Correr ANTES de deployar el backend.
//
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/apply-stripe-gateway-migration.cjs
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Divide SQL en sentencias respetando dollar-quoting ($$ ... $$). */
function splitStatements(sql) {
  const cleaned = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const out = [];
  let buf = '';
  let inDollar = false;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '$' && cleaned[i + 1] === '$') {
      inDollar = !inDollar;
      buf += '$$';
      i++;
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
  const name = '20260811_stripe_gateway';

  const sqlPath = path.join(__dirname, '..', 'prisma', 'migrations', name, 'migration.sql');
  const statements = splitStatements(fs.readFileSync(sqlPath, 'utf8'));
  for (const st of statements) {
    await prisma.$executeRawUnsafe(st);
  }
  console.log(`✅ DDL aplicado (${statements.length} sentencias, idempotente).`);

  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='Tenant' AND column_name IN ('stripeCustomerId','stripeSubscriptionId') ORDER BY column_name`,
  );
  console.log('• Columnas Tenant Stripe:', cols.map((c) => c.column_name).join(', '));
  for (const t of ['PendingStripePayment', 'StripeWebhookEvent']) {
    const r = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.tables WHERE table_name=$1 LIMIT 1`,
      t,
    );
    console.log(`• Tabla ${t}:`, r.length ? 'OK' : 'FALTA');
  }

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
