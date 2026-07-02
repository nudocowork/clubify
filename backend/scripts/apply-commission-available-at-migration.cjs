// Migración 20260827_commission_available_at (P3 PDF 2026-07-02):
//   - Commission.availableAt DateTime? — momento de desbloqueo (PENDING→APPROVED)
//     = 15 días DESPUÉS del pago real en Hotmart (Tenant.lastChargeAt / cobro del
//     grupo), NO desde createdAt de la comisión ni la creación de la cuenta.
//   - Backfill de comisiones existentes: availableAt = COALESCE(lastChargeAt del
//     tenant/grupo, createdAt) + 15 días. Solo donde availableAt IS NULL.
// Idempotente. Correr ANTES de deployar el backend nuevo.
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/apply-commission-available-at-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260827_commission_available_at';

  // 1) DDL (idempotente)
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "availableAt" TIMESTAMP(3)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Commission_availableAt_idx" ON "Commission"("availableAt")`,
  );
  console.log('✅ DDL aplicado (columna + índice, idempotente).');

  // 2) Backfill — tenant-based (comisiones normales por referralUse→tenant)
  const t = await prisma.$executeRawUnsafe(`
    UPDATE "Commission" c
    SET "availableAt" = COALESCE(t."lastChargeAt", c."createdAt") + interval '15 days'
    FROM "ReferralUse" ru
    JOIN "Tenant" t ON t.id = ru."tenantId"
    WHERE c."referralUseId" = ru.id AND c."availableAt" IS NULL
  `);
  console.log(`✅ Backfill tenant-based: ${t} comisiones`);

  // 3) Backfill — group-based (comisiones de Grupo Empresarial)
  const g = await prisma.$executeRawUnsafe(`
    UPDATE "Commission" c
    SET "availableAt" = COALESCE(bg."lastChargeAt", c."createdAt") + interval '15 days'
    FROM "BusinessGroup" bg
    WHERE c."businessGroupId" = bg.id AND c."availableAt" IS NULL
  `);
  console.log(`✅ Backfill group-based: ${g} comisiones`);

  // 4) Backfill — resto (sin use ni grupo): createdAt + 15d
  const r = await prisma.$executeRawUnsafe(`
    UPDATE "Commission" c
    SET "availableAt" = c."createdAt" + interval '15 days'
    WHERE c."availableAt" IS NULL
  `);
  console.log(`✅ Backfill restante: ${r} comisiones`);

  // 5) Registrar migración
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
  await prisma.$disconnect();
  console.log('\nListo. Ahora sí deployá el backend.');
})().catch((e) => { console.error(e); process.exit(1); });
