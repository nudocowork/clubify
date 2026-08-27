// Migración — PIN de verificación de correo para la prueba gratuita.
// Aditiva e idempotente; ningún DROP.
//   Ver:      node scripts/apply-trial-otp.cjs
//   Aplicar:  APPLY=1 node scripts/apply-trial-otp.cjs
const { PrismaClient } = require('@prisma/client');

const STMTS = [
  `CREATE TABLE IF NOT EXISTS "TrialEmailOtp" (
      "id" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "codeHash" TEXT NOT NULL,
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "consumedAt" TIMESTAMP(3),
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "ip" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "TrialEmailOtp_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "TrialEmailOtp_email_createdAt_idx" ON "TrialEmailOtp"("email","createdAt")`,
  // Para que el barrido de vencidos no recorra la tabla entera.
  `CREATE INDEX IF NOT EXISTS "TrialEmailOtp_expiresAt_idx" ON "TrialEmailOtp"("expiresAt")`,
];

const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const estado = async () =>
  (await p.$queryRawUnsafe(`SELECT to_regclass('public."TrialEmailOtp"') IS NOT NULL AS e`))[0].e;

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || '';
  console.log('base destino:', (url.match(/@([^/:]+)/) || [])[1] || '?');
  console.log('ANTES  → TrialEmailOtp:', await estado());
  if (process.env.APPLY !== '1') {
    console.log('\nDRY-RUN. Para aplicar: APPLY=1 node scripts/apply-trial-otp.cjs');
    await p.$disconnect();
    return;
  }
  for (const sql of STMTS) await p.$executeRawUnsafe(sql);
  const ok = await estado();
  console.log('DESPUÉS → TrialEmailOtp:', ok);
  console.log(ok ? '\n✓ Migración aplicada.' : '\n✗ Incompleta.');
  await p.$disconnect();
  if (!ok) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
