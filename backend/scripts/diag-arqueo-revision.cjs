// SOLO LECTURA. Arqueo de los 3 hallazgos de la revisión diaria (2026-11-16):
// fecha de cobro de La Burguesía, monto de la comisión de Café Macondo y los
// abonos de 20 que siguen «En revisión».
//   railway run --service backend --environment production --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
//     node scripts/diag-arqueo-revision.cjs
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '—');

(async () => {
  console.log('### 1. LA BURGUESÍA');
  const ts = await p.tenant.findMany({
    where: { OR: [{ name: { contains: 'burgues', mode: 'insensitive' } }, { brandName: { contains: 'burgues', mode: 'insensitive' } }] },
    select: { id: true, name: true, status: true, currentPeriodEnd: true, lastChargeAt: true, hotmartSubscriberCode: true, manualPayment: true },
  });
  for (const t of ts) {
    const tt = await p.tenant.findUnique({ where: { id: t.id }, select: { failedPaymentCount: true, firstFailedAt: true, paymentFailureNoticeSentAt: true } });
    const al = await p.auditLog.findMany({ where: { tenantId: t.id, createdAt: { gte: new Date('2026-10-20') } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, action: true, actorId: true, metadata: true } });
    console.log('  mora:', JSON.stringify(tt));
    for (const a of al) console.log('  audit', a.createdAt.toISOString().slice(0, 16), a.action, a.actorId ?? '', JSON.stringify(a.metadata).slice(0, 300));
    console.log(t.name, t.status, 'periodEnd', d(t.currentPeriodEnd), 'lastCharge', d(t.lastChargeAt), 'sub', t.hotmartSubscriberCode, 'manual', t.manualPayment);
    const ev = await p.hotmartWebhookEvent.findMany({ where: { tenantId: t.id }, orderBy: { processedAt: 'asc' }, select: { eventType: true, processedAt: true, payload: true } });
    for (const e of ev) {
      const pl = e.payload?.data ?? {};
      const pu = pl.purchase ?? {};
      const extra = e.eventType === 'UPDATE_SUBSCRIPTION_CHARGE_DATE' ? JSON.stringify(pl.subscription ?? pl).slice(0, 500) : '';
      console.log('  ', d(e.processedAt), e.eventType, 'tx', pu.transaction ?? '', 'rec', pu.recurrence_number ?? '',
        'next', pu.date_next_charge ? d(pu.date_next_charge) : '', 'offer', pu.offer?.code ?? '', extra);
    }
  }

  console.log('\n### 2. CAFÉ MACONDO');
  const ms = await p.tenant.findMany({
    where: { OR: [{ name: { contains: 'macondo', mode: 'insensitive' } }, { brandName: { contains: 'macondo', mode: 'insensitive' } }] },
    select: { id: true, name: true },
  });
  for (const t of ms) {
    console.log(t.name);
    const cs = await p.commission.findMany({
      where: { referralUse: { tenantId: t.id } }, orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, baseAmountUsd: true, amount: true, currency: true, businessDate: true, createdAt: true, hotmartTransactionId: true, periodKey: true },
    });
    for (const c of cs) console.log('  com', c.id, c.status, 'base', String(c.baseAmountUsd), 'monto', String(c.amount), c.currency, 'fecha', d(c.businessDate ?? c.createdAt), 'tx', c.hotmartTransactionId, c.periodKey);
    const is = await p.incomeRecord.findMany({ where: { tenantId: t.id }, orderBy: { saleDate: 'asc' }, select: { externalTxId: true, grossUsd: true, saleDate: true, status: true, category: true } });
    for (const i of is) console.log('  ing', i.externalTxId, String(i.grossUsd), d(i.saleDate), i.status, i.category);
  }

  console.log('\n### 3. ABONOS DE 20');
  const keys = await p.setting.findMany({ where: { key: { contains: 'abono' } }, select: { key: true, value: true } });
  console.log('  decisiones guardadas:', keys.map((k) => k.key + '=' + k.value.slice(0, 160)).join(' | ') || 'ninguna');
  const ab = await p.$queryRawUnsafe(`
    SELECT DISTINCT ON (i."externalTxId") i."externalTxId" tx, i."grossUsd"::float8 usd, i."saleDate", i.status, i."brandName",
           lower(e.payload->'data'->'buyer'->>'email') email
      FROM "IncomeRecord" i JOIN "HotmartWebhookEvent" e ON e.payload->'data'->'purchase'->>'transaction' = i."externalTxId"
     WHERE lower(e.payload->'data'->'purchase'->'offer'->>'code') = '9veek0a9'
     ORDER BY i."externalTxId"`);
  for (const a of ab) {
    const pagos = a.email
      ? await p.$queryRawUnsafe(`
          SELECT DISTINCT i."externalTxId" tx, i."grossUsd"::float8 usd, i."saleDate", i.status, i."brandName",
                 lower(e.payload->'data'->'purchase'->'offer'->>'code') oferta
            FROM "HotmartWebhookEvent" e JOIN "IncomeRecord" i ON i."externalTxId" = e.payload->'data'->'purchase'->>'transaction'
           WHERE lower(e.payload->'data'->'buyer'->>'email') = $1 AND i."externalTxId" <> $2`, a.email, a.tx)
      : [];
    const u = a.email ? await p.user.findFirst({ where: { email: { equals: a.email, mode: 'insensitive' } }, select: { tenant: { select: { name: true, status: true } } } }) : null;
    console.log(`  ${a.tx} $${a.usd} ${d(a.saleDate)} ${a.status} libro=${a.brandName ?? '—'} usuario→${u?.tenant?.name ?? '—'} ${u?.tenant?.status ?? ''}`);
    for (const x of pagos) console.log(`      otro pago del mismo correo: ${x.tx} $${x.usd} ${d(x.saleDate)} ${x.status} ${x.brandName ?? '—'} oferta ${x.oferta}`);
  }
})()
  .catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
