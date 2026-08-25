// Migración Cuponera — ADMINISTRADOR propio de cada cuponera (spec §3 y §4).
//   1. Role += 'CUPONERA_ADMIN'
//   2. User.campaignId  (+ índice y FK a BenefitCampaign, ON DELETE SET NULL:
//      borrar una cuponera no debe borrar la cuenta de su administrador)
//
// ADITIVO E IDEMPOTENTE. Nada de DROP.
//
// ⚠️ El valor del enum se agrega en su PROPIA sentencia, fuera de cualquier
// transacción: Postgres no deja USAR un valor de enum recién creado dentro de
// la misma transacción que lo crea. Es la razón por la que la migración de la
// Fase 1 tuvo que partirse en dos carpetas. Acá no lo usamos, solo lo creamos,
// pero se mantiene suelto por las dudas.
//
//   Ver:      node scripts/apply-cuponera-admin-role.cjs
//   Aplicar:  APPLY=1 node scripts/apply-cuponera-admin-role.cjs
const { PrismaClient } = require('@prisma/client');

const STMTS = [
  `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'CUPONERA_ADMIN'`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "campaignId" TEXT`,
  `CREATE INDEX IF NOT EXISTS "User_campaignId_idx" ON "User"("campaignId")`,
  `DO $$ BEGIN
     ALTER TABLE "User" ADD CONSTRAINT "User_campaignId_fkey"
       FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id")
       ON DELETE SET NULL ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
];

const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

const estado = async () => {
  const rol = await p.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'Role' AND e.enumlabel = 'CUPONERA_ADMIN'`,
  );
  const col = await p.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'User' AND column_name = 'campaignId'`,
  );
  return { rol: rol[0].n > 0, campaignId: col[0].n > 0 };
};

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || '';
  console.log('base destino:', (url.match(/@([^/:]+)/) || [])[1] || '?');

  const antes = await estado();
  console.log('ANTES  →', JSON.stringify(antes));

  if (process.env.APPLY !== '1') {
    console.log('\nDRY-RUN. Nada se escribió. Para aplicar: APPLY=1 node scripts/apply-cuponera-admin-role.cjs');
    await p.$disconnect();
    return;
  }

  for (const sql of STMTS) await p.$executeRawUnsafe(sql);

  const despues = await estado();
  console.log('DESPUÉS →', JSON.stringify(despues));
  const ok = despues.rol && despues.campaignId;
  console.log(ok ? '\n✓ Migración aplicada.' : '\n✗ Algo quedó incompleto — revisar.');
  await p.$disconnect();
  if (!ok) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
