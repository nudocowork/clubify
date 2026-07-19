// Migración 20260717_academy_videos — Academia interactiva:
//   tabla AcademyVideo (video-tutorial YouTube por módulo y por marca blanca).
// Idempotente. Correr ANTES de deployar el backend nuevo.
//   railway run --service Postgres-Nq8w node scripts/apply-academy-videos-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260717_academy_videos';

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AcademyVideo" (
      "id" TEXT NOT NULL,
      "whiteLabelId" TEXT NOT NULL,
      "moduleKey" TEXT NOT NULL,
      "youtubeUrl" TEXT NOT NULL DEFAULT '',
      "active" BOOLEAN NOT NULL DEFAULT true,
      "title" TEXT NOT NULL DEFAULT '',
      "description" TEXT NOT NULL DEFAULT '',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AcademyVideo_pkey" PRIMARY KEY ("id")
    )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "AcademyVideo_whiteLabelId_moduleKey_key" ON "AcademyVideo"("whiteLabelId", "moduleKey")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AcademyVideo_whiteLabelId_idx" ON "AcademyVideo"("whiteLabelId")`);
  // FK idempotente (Postgres no soporta ADD CONSTRAINT IF NOT EXISTS).
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AcademyVideo_whiteLabelId_fkey') THEN
        ALTER TABLE "AcademyVideo"
          ADD CONSTRAINT "AcademyVideo_whiteLabelId_fkey"
          FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$;`);
  console.log('✅ Tabla AcademyVideo + índices + FK ok.');

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
  console.log('\nListo. Ahora podés deployar el backend nuevo.');
})().catch((e) => { console.error(e); process.exit(1); });
