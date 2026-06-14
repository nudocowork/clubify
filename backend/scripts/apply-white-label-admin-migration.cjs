// Aplica la migration 20260613_white_label_admin a prod.
// 1) Agrega User.whiteLabelId + FK + índice
// 2) Crea tabla WhiteLabelAdminInvite + FKs + índices
// Usage (path absoluto, ver feedback_railway_run_cwd_path_quirk):
//   railway run --service Postgres-Nq8w node \
//     /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/apply-white-label-admin-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260613_white_label_admin';

async function tryExec(prisma, sql, label) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`✓ ${label}`);
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes('already exists') || msg.includes('duplicate') || msg.includes('does not exist')) {
      console.log(`✓ ${label} (skip: ${msg.slice(0, 80)}…)`);
    } else {
      throw e;
    }
  }
}

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // 1) Agregar columna whiteLabelId a User
  const colCheck = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='User' AND column_name='whiteLabelId'`,
  );
  if (colCheck.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "whiteLabelId" TEXT`);
    console.log('✓ User.whiteLabelId agregado');
  } else {
    console.log('✓ User.whiteLabelId ya existía');
  }

  await tryExec(prisma, `CREATE INDEX "User_whiteLabelId_idx" ON "User"("whiteLabelId")`, 'Index User.whiteLabelId');
  await tryExec(prisma, `ALTER TABLE "User" ADD CONSTRAINT "User_whiteLabelId_fkey" FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE SET NULL ON UPDATE CASCADE`, 'FK User.whiteLabelId');

  // 2) Tabla WhiteLabelAdminInvite
  await tryExec(prisma, `CREATE TABLE "WhiteLabelAdminInvite" (
    "id" TEXT NOT NULL,
    "whiteLabelId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhiteLabelAdminInvite_pkey" PRIMARY KEY ("id")
  )`, 'Tabla WhiteLabelAdminInvite');

  await tryExec(prisma, `CREATE UNIQUE INDEX "WhiteLabelAdminInvite_tokenHash_key" ON "WhiteLabelAdminInvite"("tokenHash")`, 'Index unique tokenHash');
  await tryExec(prisma, `CREATE INDEX "WhiteLabelAdminInvite_whiteLabelId_idx" ON "WhiteLabelAdminInvite"("whiteLabelId")`, 'Index whiteLabelId');
  await tryExec(prisma, `CREATE INDEX "WhiteLabelAdminInvite_email_idx" ON "WhiteLabelAdminInvite"("email")`, 'Index email');
  await tryExec(prisma, `CREATE INDEX "WhiteLabelAdminInvite_acceptedAt_revokedAt_idx" ON "WhiteLabelAdminInvite"("acceptedAt","revokedAt")`, 'Index acceptedAt,revokedAt');

  await tryExec(prisma, `ALTER TABLE "WhiteLabelAdminInvite" ADD CONSTRAINT "WhiteLabelAdminInvite_whiteLabelId_fkey" FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, 'FK whiteLabelId');
  await tryExec(prisma, `ALTER TABLE "WhiteLabelAdminInvite" ADD CONSTRAINT "WhiteLabelAdminInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE`, 'FK invitedById');
  await tryExec(prisma, `ALTER TABLE "WhiteLabelAdminInvite" ADD CONSTRAINT "WhiteLabelAdminInvite_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE`, 'FK acceptedById');

  // Registrar en _prisma_migrations si no existe
  const existing = await prisma.$queryRawUnsafe(
    `SELECT id FROM "_prisma_migrations" WHERE migration_name = $1`,
    MIGRATION_NAME,
  );
  if (existing.length === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'manual', now(), $1, NULL, NULL, now(), 1)`,
      MIGRATION_NAME,
    );
    console.log('✓ Registrado en _prisma_migrations');
  } else {
    console.log('✓ Ya estaba registrado en _prisma_migrations');
  }

  console.log('\nDone.');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
