// Pócimas mágicas By Lauren: pasó a SEMESTRAL pero el precio quedó en $150
// (trimestral) → comisión seguía $15. Fija precio $278 (canónico semestral) y
// recalcula la comisión VIVA (PENDING/APPROVED) a 10% × 278 = $27.80.
// Dry-run por defecto; APPLY=1 aplica.
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const APPLY = process.env.APPLY === '1';
  const SEMESTRAL = 278;

  const t = await prisma.tenant.findFirst({
    where: { brandName: { contains: 'cima', mode: 'insensitive' } },
    select: { id: true, brandName: true, planPeriodicity: true, subscriptionPriceUsd: true },
  });
  if (!t) { console.log('Pócimas no encontrado'); process.exit(1); }
  console.log(`${t.brandName} | plan=${t.planPeriodicity} | precio actual=$${t.subscriptionPriceUsd}`);
  if (t.planPeriodicity !== 'SEMESTRAL') console.log(`⚠️ plan no es SEMESTRAL (${t.planPeriodicity}) — revisar`);

  console.log(`\nPrecio $${t.subscriptionPriceUsd} → $${SEMESTRAL}`);
  const comms = await prisma.commission.findMany({
    where: { referralUse: { tenantId: t.id }, status: { in: ['PENDING', 'APPROVED'] } },
    select: { id: true, amount: true, status: true, appliedPercent: true, periodKey: true, recipientCode: { select: { commissionPercent: true, ownerName: true } } },
  });
  console.log(`Comisiones vivas a recalcular (${comms.length}):`);
  for (const c of comms) {
    const pct = Number(c.appliedPercent ?? c.recipientCode?.commissionPercent ?? 10);
    const newAmt = Math.round(SEMESTRAL * pct) / 100;
    console.log(`  ${c.recipientCode?.ownerName} ${c.status} period=${c.periodKey}: $${c.amount} → $${newAmt} (${pct}% × $${SEMESTRAL})`);
    if (APPLY) {
      await prisma.commission.update({ where: { id: c.id }, data: { amount: newAmt, baseAmountUsd: SEMESTRAL, appliedPercent: pct } });
    }
  }
  if (APPLY) {
    await prisma.tenant.update({ where: { id: t.id }, data: { subscriptionPriceUsd: SEMESTRAL } });
    console.log('\n✅ APLICADO (precio + comisión).');
  } else {
    console.log('\nDRY-RUN. APPLY=1 para aplicar.');
  }
  await prisma.$disconnect(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
