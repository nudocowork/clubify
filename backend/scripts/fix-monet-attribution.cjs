// ARREGLO COMPLETO de monet (aprobado por el dueño):
//  1) Plan: planPeriodicity=TRIMESTRAL + subscriptionPriceUsd=150 + currentPeriodEnd=+3m.
//  2) Atribución: ReferralUse monet → Nicolas Quintero (TAFMPWK5).
//  3) Comisión de esta 1ª venta: $15.00 (10% × $150), réplica EXACTA de
//     generateCommissionsForPayment (influencer directo, sin cadena):
//     PENDING, businessDate=compra, availableAt=compra+15d, snapshot congelado.
//  4) Recurrencia: cada renovación trimestral el webhook generará $15 solo.
//
// Idempotente: no duplica ReferralUse ni Commission. DRY-RUN por defecto; --apply escribe.
// Usage: railway run --service Postgres-Nq8w node scripts/fix-monet-attribution.cjs [--apply]
const { PrismaClient } = require('@prisma/client');
const r2 = (n) => Math.round(n * 100) / 100;
const DAY = 86400000;

const NICO_CODE = 'TAFMPWK5';
const TX = 'HP2441766991';
const PRICE = 150;
const PERIODICITY = 'TRIMESTRAL';
const PERIOD_KEY = '2026-08'; // mes de la compra

(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
  const APPLY = process.argv.includes('--apply');

  const t = await p.tenant.findFirst({
    where: { brandName: { contains: 'monet', mode: 'insensitive' } },
    select: { id: true, brandName: true, planPeriodicity: true, subscriptionPriceUsd: true, currentPeriodEnd: true, lastChargeAt: true, purchasedAt: true, commissionDistributionMode: true },
  });
  if (!t) { console.error('No hay tenant monet'); process.exit(1); }
  const nico = await p.referralCode.findUnique({ where: { code: NICO_CODE }, select: { id: true, ownerName: true, role: true, commissionPercent: true } });
  if (!nico) { console.error('No existe el código de Nicolas'); process.exit(1); }

  const charge = t.lastChargeAt ?? t.purchasedAt ?? new Date();
  const businessDate = new Date(charge);
  const availableAt = new Date(new Date(charge).getTime() + 15 * DAY);
  const newPeriodEnd = new Date(new Date(t.purchasedAt ?? charge).getTime());
  newPeriodEnd.setUTCMonth(newPeriodEnd.getUTCMonth() + 3); // trimestral = +3 meses
  const pct = Number(nico.commissionPercent ?? 10);
  const amount = r2((PRICE * pct) / 100);
  const mode = t.commissionDistributionMode ?? 'DISCOUNT_FROM_INFLUENCER';

  console.log('\n════ 1) PLAN (antes → después) ════');
  console.log(`  planPeriodicity:      ${t.planPeriodicity} → ${PERIODICITY}`);
  console.log(`  subscriptionPriceUsd: ${t.subscriptionPriceUsd} → ${PRICE}`);
  console.log(`  currentPeriodEnd:     ${t.currentPeriodEnd?.toISOString?.() ?? t.currentPeriodEnd} → ${newPeriodEnd.toISOString()}`);

  const existingUse = await p.referralUse.findFirst({ where: { tenantId: t.id, referralCodeId: nico.id }, select: { id: true } });
  console.log('\n════ 2) ATRIBUCIÓN ════');
  console.log(`  monet → ${nico.ownerName} (${NICO_CODE}, ${nico.role}) ${existingUse ? '· YA EXISTE (skip)' : '· CREAR ReferralUse'}`);

  const existingComm = await p.commission.findFirst({ where: { hotmartTransactionId: TX, recipientCodeId: nico.id }, select: { id: true } });
  console.log('\n════ 3) COMISIÓN 1ª venta ════');
  console.log(`  amount=$${amount} (${pct}% × $${PRICE}) · status=PENDING · businessDate=${businessDate.toISOString().slice(0,10)} · availableAt=${availableAt.toISOString().slice(0,10)} · tx=${TX} ${existingComm ? '· YA EXISTE (skip)' : '· CREAR'}`);

  if (!APPLY) {
    console.log('\n[DRY-RUN] No se escribió nada. Para aplicar: --apply');
    await p.$disconnect();
    return;
  }

  await p.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: t.id },
      data: { planPeriodicity: PERIODICITY, subscriptionPriceUsd: PRICE, currentPeriodEnd: newPeriodEnd },
    });
    let useId = existingUse?.id;
    if (!useId) {
      const u = await tx.referralUse.create({
        data: { referralCodeId: nico.id, tenantId: t.id, status: 'PAYING', utmSource: 'manual-admin' },
        select: { id: true },
      });
      useId = u.id;
    }
    if (!existingComm) {
      await tx.commission.create({
        data: {
          referralUseId: useId,
          amount,
          status: 'PENDING',
          paymentStatus: 'PENDING',
          amountPaid: 0,
          recipientCodeId: nico.id,
          hotmartTransactionId: TX,
          externalTxId: TX,
          periodKey: PERIOD_KEY,
          availableAt,
          businessDate,
          distributionMode: mode,
          baseAmountUsd: PRICE,
          appliedPercent: pct,
        },
      });
    }
  });
  console.log('\n✅ Aplicado: plan corregido + monet atribuido a Nicolas + comisión $' + amount + ' creada.');
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
