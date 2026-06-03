/**
 * Aplica la migración 20260713_tenant_trial_public manualmente vía
 * Prisma client + DATABASE_PUBLIC_URL del servicio Postgres-Nq8w en
 * Railway. Sirve cuando no hay psql instalado localmente y railway.internal
 * no es accesible desde la red local.
 *
 * Uso:
 *   railway run --service Postgres-Nq8w node scripts/apply-trial-migration.mjs
 *
 * El comando inyecta DATABASE_PUBLIC_URL del service Postgres-Nq8w en el
 * env del proceso. El script lo usa explícitamente (override de .env
 * local que apunta a railway.internal).
 *
 * Idempotente: usa IF NOT EXISTS + INSERT condicional. Se puede correr
 * varias veces sin romper nada.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('❌ No DATABASE_PUBLIC_URL ni DATABASE_URL en el entorno.');
  console.error('   Corré: railway run --service Postgres-Nq8w node scripts/apply-trial-migration.mjs');
  process.exit(1);
}
try {
  console.log(`🔌 Conectando a: ${new URL(url).host}`);
} catch {
  console.log('🔌 Conectando…');
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

const stmts = [
  `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "trialSource" TEXT`,
  `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "trialCompany" TEXT`,
  `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "trialCity" TEXT`,
  `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "trialReminderLastSent" TEXT`,
];

try {
  for (const sql of stmts) {
    await prisma.$executeRawUnsafe(sql);
    console.log('✅', sql);
  }

  // Registrar la migración como aplicada para que el próximo boot del
  // backend no la intente de nuevo y crashee con P3018.
  const registered = await prisma.$executeRawUnsafe(`
    INSERT INTO "_prisma_migrations"
      (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
    SELECT gen_random_uuid()::text, 'manual', NOW(), '20260713_tenant_trial_public', NULL, NULL, NOW(), 4
    WHERE NOT EXISTS (
      SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20260713_tenant_trial_public'
    )
  `);
  if (registered > 0) {
    console.log('✅ Migración registrada en _prisma_migrations');
  } else {
    console.log('ℹ️  Migración ya estaba registrada — skip');
  }

  console.log('\n🎉 Listo. Verificá con: curl https://api.soyclubify.com/api/health');
} catch (e) {
  console.error('❌ Error aplicando migración:', e.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
