// Migración 20260730000000_add_info_pages (PDF "TEAM CLUBIFY (4)"):
//   - InfoPage      (páginas informativas globales: soyclubify.com/informacion*)
//   - InfoPageLead  (leads captados por cada página)
// Páginas fijas de marketing con captación de leads + QR permanente. Idempotente.
// Correr ANTES de deployar el backend nuevo:
//   railway run --service Postgres-Nq8w node scripts/apply-info-pages-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260730000000_add_info_pages';

  const stmts = [
    `CREATE TABLE IF NOT EXISTS "InfoPage" (
      "id" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "tag" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "subtitle" TEXT,
      "logoUrl" TEXT,
      "heroImageUrl" TEXT,
      "videoUrl" TEXT,
      "description" TEXT,
      "sections" JSONB NOT NULL DEFAULT '[]',
      "ctaText" TEXT,
      "ctaUrl" TEXT,
      "formEnabled" BOOLEAN NOT NULL DEFAULT true,
      "formFields" JSONB NOT NULL DEFAULT '[]',
      "theme" JSONB NOT NULL DEFAULT '{}',
      "isPublished" BOOLEAN NOT NULL DEFAULT false,
      "views" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "InfoPage_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "InfoPage_slug_key" ON "InfoPage"("slug")`,
    // Idempotente: agrega logoUrl si la tabla ya existía de una corrida previa.
    `ALTER TABLE "InfoPage" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT`,
    `CREATE TABLE IF NOT EXISTS "InfoPageLead" (
      "id" TEXT NOT NULL,
      "infoPageId" TEXT NOT NULL,
      "data" JSONB NOT NULL DEFAULT '{}',
      "tag" TEXT NOT NULL,
      "source" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "InfoPageLead_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "InfoPageLead_infoPageId_createdAt_idx" ON "InfoPageLead"("infoPageId", "createdAt")`,
    `DO $$ BEGIN
      ALTER TABLE "InfoPageLead" ADD CONSTRAINT "InfoPageLead_infoPageId_fkey"
        FOREIGN KEY ("infoPageId") REFERENCES "InfoPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  ];
  for (const s of stmts) await prisma.$executeRawUnsafe(s);
  console.log(`✅ DDL aplicado (${stmts.length} sentencias, idempotente).`);

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
  console.log('Listo para deployar el backend. Las 2 páginas se siembran solas al iniciar (borrador).');
})().catch((e) => { console.error(e); process.exit(1); });
