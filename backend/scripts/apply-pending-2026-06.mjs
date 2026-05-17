#!/usr/bin/env node
/**
 * Aplica las 3 migrations de fin de mayo / junio 2026 que quedaron
 * pendientes en prod por el bug del wrapper migrate-resolve-and-deploy
 * (auto-marcaba "already exists" como aplicadas sin correr SQL real).
 *
 *   - 20260601_quote_plan_remove_pro
 *   - 20260603_card_min_amount_per_stamp
 *   - 20260603_remove_coupons
 *
 * Idempotente: cada paso usa IF NOT EXISTS / IF EXISTS o catchea
 * "already exists" / "does not exist".
 *
 * Uso:
 *   railway run --service Postgres-Nq8w -- bash -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/apply-pending-2026-06.mjs'
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runSafe(label, sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`✓ ${label}`);
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (/already exists|does not exist|duplicate/i.test(msg)) {
      console.log(`= ${label} (skip: ${msg.split('\n')[0].slice(0, 80)})`);
    } else {
      console.error(`✗ ${label}: ${msg}`);
      throw err;
    }
  }
}

async function main() {
  console.log('Aplicando migrations 2026-06 pendientes...\n');

  // ───── 20260603_card_min_amount_per_stamp ─────
  console.log('[1/3] Card.minAmountPerStamp');
  await runSafe(
    'ADD COLUMN Card.minAmountPerStamp',
    `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "minAmountPerStamp" DECIMAL(12, 2)`,
  );

  // ───── 20260603_remove_coupons ─────
  console.log('\n[2/3] Remove coupons (DROP TABLE/TYPE)');
  await runSafe('DROP TABLE CouponUse', `DROP TABLE IF EXISTS "CouponUse"`);
  await runSafe('DROP TABLE Coupon', `DROP TABLE IF EXISTS "Coupon"`);
  await runSafe('DROP TYPE CouponDuration', `DROP TYPE IF EXISTS "CouponDuration"`);
  await runSafe('DROP TYPE CouponStatus', `DROP TYPE IF EXISTS "CouponStatus"`);
  await runSafe(
    'ALTER Campaign DROP discountAbsorption',
    `ALTER TABLE "Campaign" DROP COLUMN IF EXISTS "discountAbsorption"`,
  );

  // ───── 20260601_quote_plan_remove_pro ─────
  console.log('\n[3/3] Quote plan remove PRO');

  const proInEnum = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'QuotePlan') AND enumlabel = 'PRO'`,
  );

  if (Array.isArray(proInEnum) && proInEnum.length > 0) {
    console.log('  PRO está en enum, procediendo con swap...');
    await runSafe(
      'UPDATE Quote PRO → ELITE',
      `UPDATE "Quote" SET "plan" = 'ELITE' WHERE "plan"::text = 'PRO'`,
    );
    // Swap atómico: rename old → create new → cast column → drop old
    try {
      await prisma.$executeRawUnsafe(`BEGIN`);
      await prisma.$executeRawUnsafe(`ALTER TYPE "QuotePlan" RENAME TO "QuotePlan_old"`);
      await prisma.$executeRawUnsafe(`CREATE TYPE "QuotePlan" AS ENUM ('ELITE')`);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Quote" ALTER COLUMN "plan" TYPE "QuotePlan" USING "plan"::text::"QuotePlan"`,
      );
      await prisma.$executeRawUnsafe(`DROP TYPE "QuotePlan_old"`);
      await prisma.$executeRawUnsafe(`COMMIT`);
      console.log('✓ Enum QuotePlan swappeado (solo ELITE)');
    } catch (e) {
      await prisma.$executeRawUnsafe(`ROLLBACK`).catch(() => {});
      console.error('✗ Swap enum falló:', e?.message ?? e);
      throw e;
    }
  } else {
    console.log('= QuotePlan ya no tiene PRO (swap previo OK)');
  }

  console.log('\n────── Verificación final ──────');
  const card = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'Card' AND column_name = 'minAmountPerStamp'`,
  );
  console.log('Card.minAmountPerStamp:', card.length > 0 ? 'OK' : 'FALTA');

  const couponTables = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_name IN ('Coupon', 'CouponUse')`,
  );
  console.log('Coupon tablas restantes (esperado 0):', couponTables.length);

  const enumVals = await prisma.$queryRawUnsafe(
    `SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'QuotePlan')`,
  );
  console.log(
    'QuotePlan valores:',
    enumVals.map((r) => r.enumlabel),
  );

  console.log('\n✓ Listo. Ahora redeploy el backend.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
