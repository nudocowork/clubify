// Apply migration 20260902_whitelabel_community_knowledge.
//  - ModuleKey += COMMUNITY (gate genérico de Comunidad/Lab por marca)
//  - KnowledgeEntry.whiteLabelId (knowledge IA por marca; null = compartida)
//  - backfill: habilita COMMUNITY SOLO para la marca Clubify (conserva Lab)
// Idempotente, aditivo. Usage (desde backend/):
//   railway run --service Postgres-Nq8w node scripts/apply-community-knowledge-migration.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('ERROR: no DB url'); process.exit(1); }
  console.log('Connecting to:', url.replace(/:\/\/[^@]+@/, '://***:***@'));
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // 1) Enum value (debe ir en su propia sentencia, fuera de transacción).
  console.log('ModuleKey += COMMUNITY…');
  await prisma.$executeRawUnsafe(`ALTER TYPE "ModuleKey" ADD VALUE IF NOT EXISTS 'COMMUNITY'`);

  // 2) KnowledgeEntry.whiteLabelId + FK + index.
  console.log('KnowledgeEntry.whiteLabelId…');
  await prisma.$executeRawUnsafe(`ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "whiteLabelId" TEXT`);
  await prisma.$executeRawUnsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'KnowledgeEntry_whiteLabelId_fkey') THEN
      ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_whiteLabelId_fkey" FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "KnowledgeEntry_whiteLabelId_isActive_audience_idx" ON "KnowledgeEntry"("whiteLabelId","isActive","audience")`);

  // 3) Backfill COMMUNITY para Clubify (separado: usa el enum recién agregado).
  console.log('Backfill COMMUNITY → Clubify…');
  const ins = await prisma.$executeRawUnsafe(`INSERT INTO "WhiteLabelModule" (id, "whiteLabelId", module, enabled, "updatedAt")
    SELECT gen_random_uuid()::text, wl.id, 'COMMUNITY', true, NOW()
    FROM "WhiteLabel" wl
    WHERE lower(wl.slug) = 'clubify'
      AND NOT EXISTS (SELECT 1 FROM "WhiteLabelModule" m WHERE m."whiteLabelId" = wl.id AND m.module = 'COMMUNITY')`);
  console.log('  COMMUNITY rows insertadas para Clubify:', ins);

  const MIG = '20260902_whitelabel_community_knowledge';
  const existing = await prisma.$queryRawUnsafe(`SELECT 1 FROM _prisma_migrations WHERE migration_name = '${MIG}' LIMIT 1`);
  if (!existing.length) {
    await prisma.$executeRawUnsafe(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (gen_random_uuid()::text, 'manual-fix-2026-06-22', NOW(), '${MIG}', NULL, NULL, NOW(), 1)`);
  } else { console.log('  (already recorded — skip)'); }

  const check = await prisma.$queryRawUnsafe(`SELECT wl.slug, m.module, m.enabled FROM "WhiteLabelModule" m JOIN "WhiteLabel" wl ON wl.id = m."whiteLabelId" WHERE m.module = 'COMMUNITY'`);
  console.log('COMMUNITY check:', check);
  await prisma.$disconnect();
  console.log('Done.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
