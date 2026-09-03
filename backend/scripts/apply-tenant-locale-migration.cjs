// Migración 20260831_tenant_locale (PDF 1254 idioma por negocio):
//   - Tenant.locale String @default("es") — idioma del negocio (panel +
//     default del storefront). Los negocios existentes quedan en 'es'.
// Idempotente. Correr ANTES de deployar el backend nuevo.
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260831_tenant_locale';

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'es'`,
  );
  console.log('✅ DDL aplicado (columna Tenant.locale, idempotente).');

  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1`, name,
  );
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), now(), 1)`,
      crypto.randomUUID(), 'manual-apply', name,
    );
    console.log('✅ Registrada en _prisma_migrations.');
  } else {
    console.log('• Ya estaba registrada.');
  }
  const n = await prisma.tenant.count();
  console.log(`\n${n} negocios (todos en locale='es' por default). Listo para deployar.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
