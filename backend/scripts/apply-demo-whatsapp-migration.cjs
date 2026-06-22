// Apply migration 20260901_whitelabel_demo_whatsapp. Agrega
// WhiteLabel.demoButtonWhatsApp (botón "Agendar demo" por marca) + setea el
// valor de Sellea. Idempotente, aditivo. Usage (desde backend/):
//   railway run --service Postgres-Nq8w node scripts/apply-demo-whatsapp-migration.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('ERROR: no DB url'); process.exit(1); }
  console.log('Connecting to:', url.replace(/:\/\/[^@]+@/, '://***:***@'));
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  console.log('Adding WhiteLabel.demoButtonWhatsApp…');
  await prisma.$executeRawUnsafe(`ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "demoButtonWhatsApp" TEXT`);

  // Setear el WhatsApp del botón demo de Sellea (solo si está vacío).
  const upd = await prisma.$executeRawUnsafe(`UPDATE "WhiteLabel" SET "demoButtonWhatsApp" = '+17865832760' WHERE lower(slug) = 'sellea' AND ("demoButtonWhatsApp" IS NULL OR "demoButtonWhatsApp" = '')`);
  console.log('Sellea demoButtonWhatsApp set (rows):', upd);

  const MIG = '20260901_whitelabel_demo_whatsapp';
  const existing = await prisma.$queryRawUnsafe(`SELECT 1 FROM _prisma_migrations WHERE migration_name = '${MIG}' LIMIT 1`);
  if (!existing.length) {
    await prisma.$executeRawUnsafe(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (gen_random_uuid()::text, 'manual-fix-2026-06-22', NOW(), '${MIG}', NULL, NULL, NOW(), 1)`);
  } else { console.log('  (already recorded — skip)'); }

  const check = await prisma.$queryRawUnsafe(`SELECT slug, "demoButtonWhatsApp" FROM "WhiteLabel" WHERE lower(slug) IN ('sellea','clubify') ORDER BY slug`);
  console.log('Check:', check);
  await prisma.$disconnect();
  console.log('Done.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
