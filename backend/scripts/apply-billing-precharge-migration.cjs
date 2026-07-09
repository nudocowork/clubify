// Aplica la migración 20260817_billing_precharge_reminders a prod de forma
// idempotente: agrega Tenant.preReminder7dSentFor + Tenant.preReminderTodaySentFor
// (nullable) y la registra en _prisma_migrations. Correr ANTES de deployar el
// backend nuevo (el cron de billing selecciona esas columnas).
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/apply-billing-precharge-migration.cjs
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260817_billing_precharge_reminders';

  const col = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_name='Tenant' AND column_name='preReminder7dSentFor' LIMIT 1`,
  );
  if (col.length) {
    console.log('• Columnas pre-cobro ya existen — salto el DDL.');
  } else {
    const sqlPath = path.join(
      __dirname,
      '..',
      'prisma',
      'migrations',
      name,
      'migration.sql',
    );
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const cleaned = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    const statements = cleaned
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const st of statements) {
      await prisma.$executeRawUnsafe(st);
    }
    console.log(`✅ DDL aplicado (${statements.length} sentencia/s).`);
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
