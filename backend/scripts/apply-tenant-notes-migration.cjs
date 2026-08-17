// Aplica 20260903_add_tenant_notes (Tenant.notes TEXT nullable — notas internas
// SOLO Clubify) y la registra en _prisma_migrations. Aditivo + idempotente
// (ADD COLUMN IF NOT EXISTS). Correr ANTES del deploy del backend que la usa.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-tenant-notes-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260903_add_tenant_notes';

  await prisma.$executeRawUnsafe(`ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "notes" TEXT`);

  const col = await prisma.$queryRawUnsafe(
    `SELECT data_type, is_nullable FROM information_schema.columns
     WHERE table_name='Tenant' AND column_name='notes'`);
  console.log('• Tenant.notes:', col.length
    ? `✓ ${col[0].data_type} nullable=${col[0].is_nullable}` : 'FALTA ✗');

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
