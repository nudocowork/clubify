// READ-ONLY. Vuelca TODOS los campos de las comisiones de las empresas dadas +
// su referralUse y el tenant, para rastrear qué generador las creó.
//   NAMES='la burguesia,sugar' railway run --service Postgres-Nq8w node scripts/trace-commission-origin.cjs
const { PrismaClient } = require('@prisma/client');

const NAMES = (process.env.NAMES || 'la burguesia,sugar & kiss')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') : '—');

(async () => {
  const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }
  const p = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  for (const name of NAMES) {
    const t = await p.tenant.findFirst({
      where: { OR: [
        { name: { contains: name, mode: 'insensitive' } },
        { brandName: { contains: name, mode: 'insensitive' } },
      ] },
      select: { id: true, name: true, brandName: true, createdAt: true, status: true,
        planPeriodicity: true, lastChargeAt: true, currentPeriodEnd: true,
        subscriptionPriceUsd: true, hotmartTransactionId: true, hotmartSubscriberCode: true },
    }).catch(async () => p.tenant.findFirst({
      where: { OR: [
        { name: { contains: name, mode: 'insensitive' } },
        { brandName: { contains: name, mode: 'insensitive' } },
      ] },
      select: { id: true, name: true, brandName: true, createdAt: true, status: true,
        planPeriodicity: true, lastChargeAt: true, currentPeriodEnd: true,
        subscriptionPriceUsd: true, hotmartTransactionId: true },
    }));
    if (!t) { console.log(`\n❓ "${name}" no encontrada`); continue; }

    console.log(`\n════════ ${t.brandName || t.name} ════════`);
    console.log(`tenant: created=${day(t.createdAt)} · status=${t.status} · ${t.planPeriodicity || 'MENSUAL'}`);
    console.log(`        lastChargeAt=${day(t.lastChargeAt)} · currentPeriodEnd=${day(t.currentPeriodEnd)} · subPriceUsd=${t.subscriptionPriceUsd ?? '—'}`);
    console.log(`        hotmartTxId=${t.hotmartTransactionId || 'NO'}${t.hotmartSubscriberCode !== undefined ? ' · subscriberCode=' + (t.hotmartSubscriberCode || 'NO') : ''}`);

    const uses = await p.referralUse.findMany({
      where: { tenantId: t.id },
      select: { id: true, status: true, createdAt: true,
        referralCode: { select: { code: true, role: true } } },
    });
    console.log(`referralUses (${uses.length}):`);
    for (const u of uses) console.log(`  use ${u.id.slice(0,8)} · ${u.referralCode?.role}/${u.referralCode?.code} · ${u.status} · created ${day(u.createdAt)}`);

    const comms = await p.commission.findMany({
      where: { referralUse: { tenantId: t.id } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, amount: true, status: true, paymentStatus: true, amountPaid: true,
        createdAt: true, availableAt: true, paidAt: true, periodKey: true,
        externalTxId: true, hotmartTransactionId: true, distributionMode: true,
        baseAmountUsd: true, appliedPercent: true, notes: true, referralUseId: true,
        recipientCode: { select: { role: true, code: true } } },
    });
    console.log(`comisiones (${comms.length}):`);
    for (const c of comms) {
      console.log(`  ── $${Number(c.amount).toFixed(2)} ${c.recipientCode?.role || '?'} · ${c.status}/${c.paymentStatus} · created ${day(c.createdAt)}`);
      console.log(`     availableAt=${day(c.availableAt)} · paidAt=${day(c.paidAt)} · periodKey=${c.periodKey || '—'} · useId=${c.referralUseId ? c.referralUseId.slice(0,8) : '—'}`);
      console.log(`     tx: externalTxId=${c.externalTxId || 'NULL'} · hotmartTxId=${c.hotmartTransactionId || 'NULL'}`);
      console.log(`     snapshot: distMode=${c.distributionMode || '—'} · baseUsd=${c.baseAmountUsd ?? '—'} · pct=${c.appliedPercent ?? '—'}`);
      if (c.notes) console.log(`     notes="${c.notes}"`);
    }
  }
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
