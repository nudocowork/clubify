// Fixes de datos (PDF comisiones/conteos 2026-06-30). Dry-run por defecto; APPLY=1 aplica.
//   1) Desactivar excepciones de comisión al 15% de "Sara y nico" (INFLUENCER)
//      → el auditor vuelve a esperar su % de código (10%). Wok/Mykoz dejan de
//      marcarse como incorrectas.
//   2) VALMONT BARBERIA: subscriptionPriceUsd 148.55 (neto) → 150 (bruto).
//   3) Backfill: negocios sin marca (whiteLabelId null, no borrados) → Clubify,
//      para que el conteo sea consistente entre admins (54 vs 46) y Burra Burger
//      quede explícitamente en Clubify.
//   4) PÓCIMAS MÁGICAS: precio real = Trimestral $150. Fija subscriptionPriceUsd=150
//      + planPeriodicity=TRIMESTRAL y corrige la comisión de Sara y nico $5 → $15
//      (10% del bruto) + backfill snapshot (baseAmountUsd=150, appliedPercent=10).
//
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/fix-commissions-counts-2026-06-30.cjs
//   railway run --service Postgres-Nq8w bash -c 'APPLY=1 node /ABS/PATH/backend/scripts/fix-commissions-counts-2026-06-30.cjs'
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const apply = process.env.APPLY === '1';
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  console.log(apply ? '== APLICANDO ==\n' : '== DRY-RUN (no escribe) ==\n');

  // ---- 1) Excepciones 15% de Sara y nico ----
  const badExc = await prisma.commissionException.findMany({
    where: {
      isActive: true,
      customPercent: 15,
      recipientCode: {
        OR: [
          { ownerName: { contains: 'nico', mode: 'insensitive' } },
          { ownerName: { contains: 'sara', mode: 'insensitive' } },
        ],
      },
    },
    select: {
      id: true, customPercent: true,
      tenant: { select: { brandName: true } },
      recipientCode: { select: { ownerName: true } },
    },
  });
  console.log(`1) Excepciones 15% a desactivar: ${badExc.length}`);
  for (const e of badExc) {
    console.log(`   · ${e.tenant?.brandName ?? '?'} → ${e.recipientCode?.ownerName ?? '?'} (${e.customPercent}%)`);
  }
  if (apply && badExc.length) {
    await prisma.commissionException.updateMany({
      where: { id: { in: badExc.map((e) => e.id) } },
      data: { isActive: false },
    });
    console.log('   ✅ desactivadas');
  }

  // ---- 2) VALMONT precio bruto ----
  const valmont = await prisma.tenant.findFirst({
    where: { brandName: { contains: 'valmont', mode: 'insensitive' } },
    select: { id: true, brandName: true, subscriptionPriceUsd: true },
  });
  console.log(`\n2) VALMONT precio: ${valmont?.subscriptionPriceUsd ?? 'null'} → 150`);
  if (valmont && apply && Number(valmont.subscriptionPriceUsd) !== 150) {
    await prisma.tenant.update({
      where: { id: valmont.id },
      data: { subscriptionPriceUsd: 150 },
    });
    console.log('   ✅ actualizado a 150');
  }

  // ---- 3) Backfill null → Clubify ----
  const clubify = await prisma.whiteLabel.findFirst({
    where: { slug: 'clubify' }, select: { id: true },
  });
  if (!clubify) { console.log('\n3) ⚠️ marca Clubify no encontrada — skip backfill'); }
  else {
    const nullTenants = await prisma.tenant.findMany({
      where: { whiteLabelId: null, deletedAt: null },
      select: { id: true, brandName: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`\n3) Negocios sin marca (null) → Clubify: ${nullTenants.length}`);
    for (const t of nullTenants) {
      console.log(`   · ${t.brandName} (${t.createdAt.toISOString().slice(0, 10)})`);
    }
    if (apply && nullTenants.length) {
      const res = await prisma.tenant.updateMany({
        where: { id: { in: nullTenants.map((t) => t.id) } },
        data: { whiteLabelId: clubify.id },
      });
      console.log(`   ✅ ${res.count} negocios asignados a Clubify`);
    }
  }

  // ---- 4) PÓCIMAS: precio Trimestral $150 + comisión $5 → $15 ----
  const poc = await prisma.tenant.findFirst({
    where: {
      OR: [
        { brandName: { contains: 'pócima', mode: 'insensitive' } },
        { brandName: { contains: 'pocima', mode: 'insensitive' } },
      ],
    },
    select: { id: true, brandName: true, subscriptionPriceUsd: true, planPeriodicity: true },
  });
  console.log(`\n4) PÓCIMAS: precio ${poc?.subscriptionPriceUsd ?? 'null'}/${poc?.planPeriodicity ?? 'null'} → 150/TRIMESTRAL`);
  if (poc) {
    const comms = await prisma.commission.findMany({
      where: {
        referralUse: { tenantId: poc.id },
        status: { in: ['PENDING', 'APPROVED', 'PAID'] },
        recipientCode: {
          OR: [
            { ownerName: { contains: 'nico', mode: 'insensitive' } },
            { ownerName: { contains: 'sara', mode: 'insensitive' } },
          ],
        },
      },
      select: { id: true, amount: true, status: true },
    });
    for (const c of comms) {
      console.log(`   · comisión ${c.id.slice(0, 8)} $${Number(c.amount)} (${c.status}) → $15`);
    }
    if (apply) {
      await prisma.tenant.update({
        where: { id: poc.id },
        data: { subscriptionPriceUsd: 150, planPeriodicity: 'TRIMESTRAL' },
      });
      for (const c of comms) {
        const data = { amount: 15, baseAmountUsd: 150, appliedPercent: 10 };
        if (c.status === 'PAID') data.amountPaid = 15;
        await prisma.commission.update({ where: { id: c.id }, data });
      }
      console.log(`   ✅ precio 150/TRIMESTRAL + ${comms.length} comisión(es) a $15`);
    }
  }

  console.log(apply ? '\nListo.' : "\nRe-corre con bash -c 'APPLY=1 node ...' para aplicar.");
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
