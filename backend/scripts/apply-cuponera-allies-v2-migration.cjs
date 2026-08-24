// Migración Cuponera — aliados Tipo A/B, multi-sede y límites por período.
// Cubre los puntos §5, §7, §9, §16, §17 y §19 del spec de Cuponeras:
//   1. AllyBusiness.tenantId  → vincula el aliado con su Tenant de la marca
//      blanca. CON valor = Tipo A (su escáner de siempre debe reconocer la
//      tarjeta de la cuponera). NULL = Tipo B (aliado externo).
//   2. AllyLocation           → sedes múltiples por aliado, cada una con su
//      geofence y mensaje propios.
//   3. Benefit.limitPeriod    → ventana de conteo del tope por miembro.
//      DEFAULT 'LIFETIME' preserva EXACTAMENTE el comportamiento actual
//      (maxPerMember era un tope total, sin período).
//   4. Redemption.locationId  → en qué sede se canjeó.
//
// ADITIVO E IDEMPOTENTE: nada de DROP, todo IF NOT EXISTS. Correrlo dos veces
// no hace daño. Requiere las Fases 1-3 aplicadas.
//
//   Ver:      node scripts/apply-cuponera-allies-v2-migration.cjs
//   Aplicar:  APPLY=1 node scripts/apply-cuponera-allies-v2-migration.cjs
const { PrismaClient } = require('@prisma/client');

const STMTS = [
  // --- 3) enum del período (tipo NUEVO, no ALTER TYPE ADD VALUE: no aplica la
  //        restricción de Postgres de usar un valor recién creado en la misma
  //        transacción, que fue lo que obligó a partir la migración de Fase 1).
  `DO $$ BEGIN CREATE TYPE "BenefitLimitPeriod" AS ENUM ('LIFETIME','DAY','WEEK','MONTH','YEAR'); EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // --- 1) AllyBusiness.tenantId (Tipo A / Tipo B)
  `ALTER TABLE "AllyBusiness" ADD COLUMN IF NOT EXISTS "tenantId" TEXT`,
  `CREATE INDEX IF NOT EXISTS "AllyBusiness_tenantId_idx" ON "AllyBusiness"("tenantId")`,
  `DO $$ BEGIN
     ALTER TABLE "AllyBusiness" ADD CONSTRAINT "AllyBusiness_tenantId_fkey"
       FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // --- 2) AllyLocation (sedes)
  `CREATE TABLE IF NOT EXISTS "AllyLocation" (
      "id" TEXT NOT NULL,
      "allyBusinessId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "address" TEXT NOT NULL DEFAULT '',
      "city" TEXT NOT NULL DEFAULT '',
      "latitude" DECIMAL(10,7),
      "longitude" DECIMAL(10,7),
      "radiusMeters" INTEGER NOT NULL DEFAULT 150,
      "geopushMessage" TEXT NOT NULL DEFAULT '',
      "geopushActive" BOOLEAN NOT NULL DEFAULT false,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AllyLocation_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "AllyLocation_allyBusinessId_isActive_idx" ON "AllyLocation"("allyBusinessId","isActive")`,
  `CREATE INDEX IF NOT EXISTS "AllyLocation_geopushActive_idx" ON "AllyLocation"("geopushActive")`,
  `DO $$ BEGIN
     ALTER TABLE "AllyLocation" ADD CONSTRAINT "AllyLocation_allyBusinessId_fkey"
       FOREIGN KEY ("allyBusinessId") REFERENCES "AllyBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // --- 3) Benefit.limitPeriod
  `ALTER TABLE "Benefit" ADD COLUMN IF NOT EXISTS "limitPeriod" "BenefitLimitPeriod" NOT NULL DEFAULT 'LIFETIME'`,

  // --- 4) Redemption.locationId
  `ALTER TABLE "Redemption" ADD COLUMN IF NOT EXISTS "locationId" TEXT`,
  `CREATE INDEX IF NOT EXISTS "Redemption_locationId_idx" ON "Redemption"("locationId")`,
  `DO $$ BEGIN
     ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_locationId_fkey"
       FOREIGN KEY ("locationId") REFERENCES "AllyLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
];

const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

const estado = async () => {
  const col = async (t, c) =>
    (await p.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
      t, c,
    ))[0].n > 0;
  const tabla = async (t) =>
    (await p.$queryRawUnsafe(`SELECT to_regclass('public."${t}"') IS NOT NULL AS e`))[0].e;
  return {
    allyTenantId: await col('AllyBusiness', 'tenantId'),
    allyLocation: await tabla('AllyLocation'),
    limitPeriod: await col('Benefit', 'limitPeriod'),
    redemptionLoc: await col('Redemption', 'locationId'),
  };
};

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || '';
  console.log('base destino:', (url.match(/@([^/:]+)/) || [])[1] || '?');

  const antes = await estado();
  console.log('ANTES  →', JSON.stringify(antes));

  if (process.env.APPLY !== '1') {
    console.log('\nDRY-RUN. Nada se escribió. Para aplicar: APPLY=1 node scripts/apply-cuponera-allies-v2-migration.cjs');
    await p.$disconnect();
    return;
  }

  for (const sql of STMTS) await p.$executeRawUnsafe(sql);

  const despues = await estado();
  console.log('DESPUÉS →', JSON.stringify(despues));
  const ok = Object.values(despues).every(Boolean);
  console.log(ok ? '\n✓ Migración aplicada.' : '\n✗ Algo quedó incompleto — revisar.');
  await p.$disconnect();
  if (!ok) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
