// Migración — avisos del aliado (spec §22). Tabla AllyPush.
// Aditiva e idempotente; ningún DROP.
//   Ver:      node scripts/apply-ally-push.cjs
//   Aplicar:  APPLY=1 node scripts/apply-ally-push.cjs
const { PrismaClient } = require('@prisma/client');
const STMTS = [
  `CREATE TABLE IF NOT EXISTS "AllyPush" (
      "id" TEXT NOT NULL,
      "campaignId" TEXT NOT NULL,
      "allyBusinessId" TEXT NOT NULL,
      "userId" TEXT,
      "title" TEXT NOT NULL,
      "body" TEXT NOT NULL,
      "targeted" INTEGER NOT NULL DEFAULT 0,
      "sent" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AllyPush_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "AllyPush_allyBusinessId_createdAt_idx" ON "AllyPush"("allyBusinessId","createdAt")`,
  `CREATE INDEX IF NOT EXISTS "AllyPush_campaignId_createdAt_idx" ON "AllyPush"("campaignId","createdAt")`,
  // El historial muere con el aliado: sin él no significa nada.
  `DO $$ BEGIN
     ALTER TABLE "AllyPush" ADD CONSTRAINT "AllyPush_allyBusinessId_fkey"
       FOREIGN KEY ("allyBusinessId") REFERENCES "AllyBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
];
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const estado = async () => (await p.$queryRawUnsafe(`SELECT to_regclass('public."AllyPush"') IS NOT NULL AS e`))[0].e;
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || '';
  console.log('base destino:', (url.match(/@([^/:]+)/) || [])[1] || '?');
  console.log('ANTES  → AllyPush:', await estado());
  if (process.env.APPLY !== '1') {
    console.log('\nDRY-RUN. Para aplicar: APPLY=1 node scripts/apply-ally-push.cjs');
    await p.$disconnect(); return;
  }
  for (const sql of STMTS) await p.$executeRawUnsafe(sql);
  const ok = await estado();
  console.log('DESPUÉS → AllyPush:', ok);
  console.log(ok ? '\n✓ Migración aplicada.' : '\n✗ Incompleta.');
  await p.$disconnect();
  if (!ok) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
