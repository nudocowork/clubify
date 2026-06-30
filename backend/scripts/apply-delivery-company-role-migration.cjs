// Migración 20260822_delivery_company_role (Fase 2 — portal empresa):
//   - enum Role += DELIVERY_COMPANY
//   - User.deliveryCompanyId (TEXT nullable) + FK a DeliveryCompany + índice
// Idempotente. Correr ANTES de deployar el backend nuevo.
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/apply-delivery-company-role-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260822_delivery_company_role';

  // ADD VALUE no admite IF NOT EXISTS dentro de algunas versiones vía prepared;
  // lo hacemos con DO-block atrapando el caso "ya existe".
  const statements = [
    `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DELIVERY_COMPANY'`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deliveryCompanyId" TEXT`,
    `CREATE INDEX IF NOT EXISTS "User_deliveryCompanyId_idx" ON "User"("deliveryCompanyId")`,
    `DO $$ BEGIN
       ALTER TABLE "User" ADD CONSTRAINT "User_deliveryCompanyId_fkey"
         FOREIGN KEY ("deliveryCompanyId") REFERENCES "DeliveryCompany"("id")
         ON DELETE SET NULL ON UPDATE CASCADE;
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
  ];

  for (const st of statements) {
    await prisma.$executeRawUnsafe(st);
  }
  console.log(`✅ DDL aplicado (${statements.length} sentencias, idempotente).`);

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
