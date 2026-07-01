// Migración 20260825_group_commission (Punto 2 — comisión de Grupo Empresarial):
//   - Commission.referralUseId → NULLABLE (comisiones de grupo no tienen tenant)
//   - Commission.businessGroupId (+ FK + índice)
//   - BusinessGroup.referralCodeId (recipiente de comisión) (+ FK + índice)
// Idempotente. Correr ANTES de deployar el backend nuevo.
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/apply-group-commission-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260825_group_commission';

  const statements = [
    `ALTER TABLE "Commission" ALTER COLUMN "referralUseId" DROP NOT NULL`,
    `ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "businessGroupId" TEXT`,
    `CREATE INDEX IF NOT EXISTS "Commission_businessGroupId_idx" ON "Commission"("businessGroupId")`,
    `DO $$ BEGIN
       ALTER TABLE "Commission" ADD CONSTRAINT "Commission_businessGroupId_fkey"
         FOREIGN KEY ("businessGroupId") REFERENCES "BusinessGroup"("id")
         ON DELETE SET NULL ON UPDATE CASCADE;
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `ALTER TABLE "BusinessGroup" ADD COLUMN IF NOT EXISTS "referralCodeId" TEXT`,
    `CREATE INDEX IF NOT EXISTS "BusinessGroup_referralCodeId_idx" ON "BusinessGroup"("referralCodeId")`,
    `DO $$ BEGIN
       ALTER TABLE "BusinessGroup" ADD CONSTRAINT "BusinessGroup_referralCodeId_fkey"
         FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id")
         ON DELETE SET NULL ON UPDATE CASCADE;
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
  ];
  for (const st of statements) await prisma.$executeRawUnsafe(st);
  console.log(`✅ DDL aplicado (${statements.length} sentencias, idempotente).`);

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
