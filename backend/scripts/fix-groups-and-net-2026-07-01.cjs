// Fixes de datos PDF 2026-07-01 (comisiones grupo + neto→bruto). Dry-run por
// defecto; APPLY=1 aplica.
//
//   P2) PIATTO-PRESTTO: comisión $14.86 → $15. subscriptionPriceUsd 148.55
//       (neto, con fee de pasarela) → 150 (bruto). Corrige sus comisiones
//       vivas al 10% del bruto ($15) + snapshot (baseAmountUsd=150,
//       appliedPercent=10). Además ESCANEA otros negocios cuyo
//       subscriptionPriceUsd quedó apenas por debajo de un precio canónico
//       (candidatos al mismo bug neto) y los reporta (no los toca).
//
//   P1) GRUPOS EMPRESARIALES: por cada grupo ACTIVE con recipiente
//       (referralCodeId) + periodicidad válida, genera SU comisión del periodo
//       si falta (1 × bruto canónico de la periodicidad × % del código).
//       Idempotente por (grupo, recipiente, periodKey). Replica
//       ReferralsService.generateGroupCommission para backfill inmediato.
//
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/fix-groups-and-net-2026-07-01.cjs
//   railway run --service Postgres-Nq8w bash -c 'APPLY=1 node /ABS/PATH/backend/scripts/fix-groups-and-net-2026-07-01.cjs'
const { PrismaClient } = require('@prisma/client');

// Precios canónicos (bruto) por periodicidad — misma tabla que el motor.
const CANON = { MENSUAL: 68, TRIMESTRAL: 150, SEMESTRAL: 278, ANUAL: 500 };

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const apply = process.env.APPLY === '1';
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  console.log(apply ? '== APLICANDO ==\n' : '== DRY-RUN (no escribe) ==\n');

  // ============================================================
  // P2) Fee-neto de TRIMESTRAL $150 → bruto ($14.86 → $15).
  //     Afecta a los negocios cuyo subscriptionPriceUsd quedó en ~$148.55
  //     (150 menos el fee de pasarela ~1%): Piatto-Prestto y Urban Cafe.
  //     Los de $135 (90% exacto) son descuento intencional → NO se tocan.
  // ============================================================
  const feeNet = await prisma.tenant.findMany({
    where: {
      deletedAt: null,
      subscriptionPriceUsd: { gte: 147, lt: 150 }, // banda del fee-neto de $150
    },
    select: { id: true, brandName: true, subscriptionPriceUsd: true, planPeriodicity: true },
  });
  console.log(`P2) Fee-neto de $150 → bruto (${feeNet.length} negocio/s en banda 147–149.99):`);
  for (const t of feeNet) {
    console.log(`   ${t.brandName}: ${t.subscriptionPriceUsd}/${t.planPeriodicity ?? 'null'} → 150/${t.planPeriodicity ?? 'TRIMESTRAL'}`);
    const comms = await prisma.commission.findMany({
      where: {
        referralUse: { tenantId: t.id },
        status: { in: ['PENDING', 'APPROVED', 'PAID'] },
      },
      select: {
        id: true, amount: true, status: true, appliedPercent: true,
        recipientCode: { select: { ownerName: true, commissionPercent: true } },
      },
    });
    for (const c of comms) {
      const pct = Number(c.appliedPercent ?? c.recipientCode?.commissionPercent ?? 10);
      const expected = Math.round(150 * pct) / 100;
      console.log(`     · ${c.recipientCode?.ownerName ?? '?'} ${pct}% · $${Number(c.amount)} (${c.status}) → $${expected}`);
    }
    if (apply) {
      await prisma.tenant.update({
        where: { id: t.id },
        data: { subscriptionPriceUsd: 150, planPeriodicity: t.planPeriodicity ?? 'TRIMESTRAL' },
      });
      for (const c of comms) {
        const pct = Number(c.appliedPercent ?? c.recipientCode?.commissionPercent ?? 10);
        const expected = Math.round(150 * pct) / 100;
        const data = { amount: expected, baseAmountUsd: 150, appliedPercent: pct };
        if (c.status === 'PAID') data.amountPaid = expected;
        await prisma.commission.update({ where: { id: c.id }, data });
      }
      console.log(`     ✅ precio 150 + ${comms.length} comisión(es) al bruto`);
    }
  }

  // ---- Escaneo: otros negocios con precio "neto" (apenas < canónico) ----
  console.log('\n   Escaneo de posibles netos (precio entre 90%–99.9% de un canónico):');
  const actives = await prisma.tenant.findMany({
    where: { deletedAt: null, subscriptionPriceUsd: { not: null } },
    select: { id: true, brandName: true, subscriptionPriceUsd: true, planPeriodicity: true },
  });
  let suspects = 0;
  for (const t of actives) {
    const p = Number(t.subscriptionPriceUsd);
    if (!Number.isFinite(p) || p <= 0) continue;
    for (const [period, canon] of Object.entries(CANON)) {
      if (p >= canon * 0.9 && p < canon - 0.01) {
        console.log(`     · ${t.brandName}: $${p} ≈ neto de ${period} $${canon}`);
        suspects++;
        break;
      }
    }
  }
  if (!suspects) console.log('     (ninguno)');

  // ============================================================
  // P1) Backfill comisiones de GRUPOS activos con recipiente
  // ============================================================
  console.log('\nP1) GRUPOS EMPRESARIALES — comisión del periodo');
  const now = new Date();
  const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const groups = await prisma.businessGroup.findMany({
    where: { deletedAt: null },
    select: {
      id: true, name: true, status: true, planPeriodicity: true, referralCodeId: true,
      referralCode: { select: { id: true, ownerName: true, role: true, commissionPercent: true, isActive: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`   Grupos: ${groups.length}`);
  // P1-pre: Grupo Mistika paga $150 TRIMESTRAL (confirmado por el usuario). Su
  // periodicidad estaba en MENSUAL → la comisión saldría $6.80 en vez de $15.
  for (const g of groups) {
    if (/mistika/i.test(g.name) && (g.planPeriodicity ?? '').toUpperCase() !== 'TRIMESTRAL') {
      console.log(`   ↳ corrige periodicidad de "${g.name}": ${g.planPeriodicity ?? 'null'} → TRIMESTRAL`);
      if (apply) await prisma.businessGroup.update({ where: { id: g.id }, data: { planPeriodicity: 'TRIMESTRAL' } });
      g.planPeriodicity = 'TRIMESTRAL';
    }
  }
  for (const g of groups) {
    const rec = g.referralCode ? `${g.referralCode.ownerName ?? '?'} (${g.referralCode.role} ${g.referralCode.commissionPercent}%)` : '— sin recipiente —';
    console.log(`   · ${g.name} [${g.status}] periodicidad=${g.planPeriodicity ?? 'null'} → ${rec}`);
    if (g.status !== 'ACTIVE') { console.log('       skip: no ACTIVE'); continue; }
    if (!g.referralCodeId || !g.referralCode) { console.log('       skip: sin recipiente'); continue; }
    if (g.referralCode.isActive === false) { console.log('       skip: código inactivo'); continue; }
    const canon = CANON[(g.planPeriodicity ?? '').toUpperCase()];
    if (!canon) { console.log('       ⚠️ skip: periodicidad inválida/null — asigna la periodicidad en el panel'); continue; }
    const pct = Number(g.referralCode.commissionPercent ?? 0);
    if (!(pct > 0)) { console.log('       skip: % del código = 0'); continue; }
    const amount = Math.round(canon * pct) / 100;
    const existing = await prisma.commission.findFirst({
      where: { businessGroupId: g.id, recipientCodeId: g.referralCode.id, periodKey },
      select: { id: true },
    });
    if (existing) { console.log(`       ya existe comisión de este periodo ($${amount}) — ok`); continue; }
    console.log(`       → generaría comisión $${amount} (${pct}% de $${canon}) periodo ${periodKey}`);
    if (apply) {
      await prisma.commission.create({
        data: {
          businessGroupId: g.id,
          referralUseId: null,
          recipientCodeId: g.referralCode.id,
          amount,
          baseAmountUsd: canon,
          appliedPercent: pct,
          currency: 'USD',
          status: 'PENDING',
          periodKey,
        },
      });
      console.log('       ✅ comisión creada');
    }
  }

  console.log(apply ? '\nListo.' : "\nRe-corre con bash -c 'APPLY=1 node ...' para aplicar.");
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
