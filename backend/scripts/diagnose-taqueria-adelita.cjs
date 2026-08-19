/* READ-ONLY. Diagnóstico del caso Taquería la adelita (compra por link de afiliado
 * + registro por /activar → plan mal y sin influencer). Solo SELECT. */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const EMAIL = 'taquerialadelita1004@gmail.com';
const d = (x) => (x ? new Date(x).toISOString().slice(0, 16) : '—');

(async () => {
  const t = await prisma.tenant.findFirst({
    where: { email: { equals: EMAIL, mode: 'insensitive' } },
    select: {
      id: true, brandName: true, status: true, planPeriodicity: true,
      subscriptionPriceUsd: true, currentPeriodEnd: true, lastChargeAt: true,
      hotmartSubscriberCode: true, hotmartTransactionId: true, whiteLabelId: true,
      createdAt: true, referredByCode: true,
      referralUses: {
        select: {
          id: true, status: true, viaSlug: true,
          referralCode: { select: { code: true, ownerName: true, role: true } },
        },
      },
    },
  });
  console.log('=== TENANT ===');
  if (!t) { console.log('  (no encontrado por email)'); }
  else {
    console.log(`  ${t.brandName} [${t.status}] id=${t.id}`);
    console.log(`  planPeriodicity=${t.planPeriodicity} · subPriceUsd=${t.subscriptionPriceUsd} · currentPeriodEnd=${d(t.currentPeriodEnd)}`);
    console.log(`  lastChargeAt=${d(t.lastChargeAt)} · createdAt=${d(t.createdAt)}`);
    console.log(`  hotmartSub=${t.hotmartSubscriberCode ?? '—'} · hotmartTx=${t.hotmartTransactionId ?? '—'} · referredByCode=${t.referredByCode ?? '—'}`);
    console.log(`  ReferralUses (${t.referralUses.length}):`);
    for (const ru of t.referralUses) {
      console.log(`    - use ${ru.id} [${ru.status}] via=${ru.viaSlug ?? '—'} → code ${ru.referralCode?.code} (${ru.referralCode?.ownerName}, ${ru.referralCode?.role})`);
    }
  }

  console.log('\n=== COMISIONES ligadas al tenant (por referralUse.tenant) ===');
  const comms = await prisma.commission.findMany({
    where: { referralUse: { tenant: { email: { equals: EMAIL, mode: 'insensitive' } } } },
    select: { id: true, amount: true, status: true, businessDate: true, createdAt: true, recipientCode: { select: { code: true, ownerName: true } } },
  });
  if (!comms.length) console.log('  (ninguna por referralUse.tenant)');
  for (const c of comms) console.log(`  - $${Number(c.amount)} [${c.status}] biz=${d(c.businessDate)} → ${c.recipientCode?.ownerName} (${c.recipientCode?.code})`);

  console.log('\n=== PendingHotmartPayment ===');
  const pend = await prisma.pendingHotmartPayment.findMany({
    where: { email: { equals: EMAIL, mode: 'insensitive' } },
    select: { id: true, event: true, subscriberCode: true, transactionId: true, consumedAt: true, createdAt: true, rawPayload: true },
  });
  for (const p of pend) {
    const raw = p.rawPayload || {};
    // buscar el src/tracking.source en el payload
    const src = raw?.data?.purchase?.tracking?.source ?? raw?.tracking?.source ?? raw?.data?.tracking?.source ?? '(no encontrado en payload)';
    const offer = raw?.data?.purchase?.offer?.code ?? raw?.data?.purchase?.plan?.name ?? '(?)';
    console.log(`  - ${p.event} sub=${p.subscriberCode ?? '—'} tx=${p.transactionId ?? '—'} consumedAt=${d(p.consumedAt)} createdAt=${d(p.createdAt)}`);
    console.log(`    tracking.source(src)=${src} · offer/plan=${offer}`);
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
