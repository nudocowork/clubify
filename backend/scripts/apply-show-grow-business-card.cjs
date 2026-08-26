// Aplica 20260826_add_show_grow_business_card (WhiteLabel.showGrowBusinessCard
// BOOLEAN default true) + oculta la tarjeta para Sellea. Aditivo + idempotente.
// Correr ANTES del deploy del backend que la usa.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-show-grow-business-card.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const DDL = [
  `ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "showGrowBusinessCard" BOOLEAN NOT NULL DEFAULT true`,
  `UPDATE "WhiteLabel" SET "showGrowBusinessCard" = false WHERE slug = 'sellea'`,
];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260826_add_show_grow_business_card';

  for (const sql of DDL) await prisma.$executeRawUnsafe(sql);

  const col = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name='WhiteLabel' AND column_name='showGrowBusinessCard'`);
  console.log('• WhiteLabel.showGrowBusinessCard:', col.length ? '✓ columna presente' : 'FALTA ✗');

  const rows = await prisma.$queryRawUnsafe(
    `SELECT slug, "showGrowBusinessCard" FROM "WhiteLabel" WHERE slug IN ('clubify','sellea') ORDER BY slug`);
  console.log('• Estado:', JSON.stringify(rows));

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
})().catch((e) => { console.error(e.message); process.exit(1); });
