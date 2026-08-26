// Migración — pasarelas de la cuponera (spec §24-25): Hotmart y Stripe.
// Aditiva e idempotente; ningún DROP, ningún NOT NULL sin default.
//   Ver:      node scripts/apply-cuponera-gateways.cjs
//   Aplicar:  APPLY=1 node scripts/apply-cuponera-gateways.cjs
const { PrismaClient } = require('@prisma/client');

const STMTS = [
  // Valores nuevos del enum. ADD VALUE IF NOT EXISTS es idempotente y no
  // reescribe la tabla; los valores viejos siguen intactos.
  `ALTER TYPE "MembershipSource" ADD VALUE IF NOT EXISTS 'HOTMART'`,
  `ALTER TYPE "MembershipSource" ADD VALUE IF NOT EXISTS 'STRIPE'`,

  // Tabla de traducción producto-de-pasarela → plan. Sin esto el webhook
  // recibe el pago y no sabe a quién dar de alta.
  `ALTER TABLE "MembershipPlan" ADD COLUMN IF NOT EXISTS "hotmartProductId" TEXT`,
  `ALTER TABLE "MembershipPlan" ADD COLUMN IF NOT EXISTS "hotmartOfferCode" TEXT`,
  `ALTER TABLE "MembershipPlan" ADD COLUMN IF NOT EXISTS "stripePriceId" TEXT`,
  `ALTER TABLE "MembershipPlan" ADD COLUMN IF NOT EXISTS "hotmartCheckoutUrl" TEXT`,
  `ALTER TABLE "MembershipPlan" ADD COLUMN IF NOT EXISTS "stripeCheckoutUrl" TEXT`,
  `CREATE INDEX IF NOT EXISTS "MembershipPlan_hotmartProductId_idx" ON "MembershipPlan"("hotmartProductId")`,
  `CREATE INDEX IF NOT EXISTS "MembershipPlan_stripePriceId_idx" ON "MembershipPlan"("stripePriceId")`,

  // Referencia recurrente genérica: la cancelación llega identificando SOLO
  // esto (subscriberCode / subscription / preapproval), sin email ni plan.
  `ALTER TABLE "LivingMembership" ADD COLUMN IF NOT EXISTS "provider" "PaymentGateway"`,
  `ALTER TABLE "LivingMembership" ADD COLUMN IF NOT EXISTS "providerRef" TEXT`,
  `CREATE INDEX IF NOT EXISTS "LivingMembership_providerRef_idx" ON "LivingMembership"("providerRef")`,

  // Backfill: las membresías que ya vinieron por MercadoPago tienen su
  // preapproval en la columna vieja. Sin esto, una cancelación de MP sobre una
  // membresía anterior a esta migración no encontraría a quién dar de baja.
  `UPDATE "LivingMembership"
      SET "provider" = 'MERCADOPAGO', "providerRef" = "mpPreapprovalId"
    WHERE "mpPreapprovalId" IS NOT NULL AND "providerRef" IS NULL`,
];

const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

const cols = async (tabla, lista) =>
  (
    await p.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = $1 AND column_name = ANY($2::text[])`,
      tabla,
      lista,
    )
  ).map((r) => r.column_name);

const enums = async () =>
  (
    await p.$queryRawUnsafe(
      `SELECT e.enumlabel AS v FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'MembershipSource'`,
    )
  ).map((r) => r.v);

const PLAN_COLS = [
  'hotmartProductId', 'hotmartOfferCode', 'stripePriceId',
  'hotmartCheckoutUrl', 'stripeCheckoutUrl',
];
const MS_COLS = ['provider', 'providerRef'];

const estado = async () => ({
  plan: await cols('MembershipPlan', PLAN_COLS),
  membership: await cols('LivingMembership', MS_COLS),
  source: await enums(),
});

const completo = (e) =>
  PLAN_COLS.every((c) => e.plan.includes(c)) &&
  MS_COLS.every((c) => e.membership.includes(c)) &&
  ['HOTMART', 'STRIPE'].every((v) => e.source.includes(v));

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || '';
  console.log('base destino:', (url.match(/@([^/:]+)/) || [])[1] || '?');
  const antes = await estado();
  console.log('ANTES  →', JSON.stringify(antes));

  if (process.env.APPLY !== '1') {
    console.log('\nDRY-RUN. Para aplicar: APPLY=1 node scripts/apply-cuponera-gateways.cjs');
    await p.$disconnect();
    return;
  }

  // ALTER TYPE ... ADD VALUE no puede correr dentro del mismo bloque que luego
  // USA el valor nuevo, así que cada sentencia va suelta (sin transacción).
  for (const sql of STMTS) await p.$executeRawUnsafe(sql);

  const despues = await estado();
  console.log('DESPUÉS →', JSON.stringify(despues));
  const ok = completo(despues);
  console.log(ok ? '\n✓ Migración aplicada.' : '\n✗ Incompleta.');
  await p.$disconnect();
  if (!ok) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
