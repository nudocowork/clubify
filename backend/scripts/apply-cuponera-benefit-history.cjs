// Migración Cuponera — historial de cambios del beneficio (spec §6).
// Tabla BenefitChange. Aditiva e idempotente; ningún DROP.
//   Ver:      node scripts/apply-cuponera-benefit-history.cjs
//   Aplicar:  APPLY=1 node scripts/apply-cuponera-benefit-history.cjs
const { PrismaClient } = require('@prisma/client');

const STMTS = [
  `CREATE TABLE IF NOT EXISTS "BenefitChange" (
      "id" TEXT NOT NULL,
      "benefitId" TEXT NOT NULL,
      "userId" TEXT,
      "actorName" TEXT NOT NULL DEFAULT '',
      "actorRole" TEXT NOT NULL DEFAULT '',
      "action" TEXT NOT NULL DEFAULT 'UPDATE',
      "changes" JSONB NOT NULL DEFAULT '{}',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "BenefitChange_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "BenefitChange_benefitId_createdAt_idx" ON "BenefitChange"("benefitId","createdAt")`,
  // El historial muere con el beneficio: sin él no significa nada.
  `DO $$ BEGIN
     ALTER TABLE "BenefitChange" ADD CONSTRAINT "BenefitChange_benefitId_fkey"
       FOREIGN KEY ("benefitId") REFERENCES "Benefit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
];

const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const estado = async () =>
  (await p.$queryRawUnsafe(`SELECT to_regclass('public."BenefitChange"') IS NOT NULL AS e`))[0].e;

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || '';
  console.log('base destino:', (url.match(/@([^/:]+)/) || [])[1] || '?');
  console.log('ANTES  → BenefitChange:', await estado());
  if (process.env.APPLY !== '1') {
    console.log('\nDRY-RUN. Nada se escribió. Para aplicar: APPLY=1 node scripts/apply-cuponera-benefit-history.cjs');
    await p.$disconnect();
    return;
  }
  for (const sql of STMTS) await p.$executeRawUnsafe(sql);
  const ok = await estado();
  console.log('DESPUÉS → BenefitChange:', ok);
  console.log(ok ? '\n✓ Migración aplicada.' : '\n✗ Incompleta.');
  await p.$disconnect();
  if (!ok) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
