// Solo lectura. Por qué una compra de las últimas 48 h no sale en el Sales Wall:
// el muro lee IncomeRecord PAGADO con negocio; este script muestra en qué paso se quedó.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const hora = (d) => (d ? new Date(new Date(d).getTime() - 5 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') : '—');
(async () => {
  console.log('== HOTMART (compras aprobadas) ==');
  const ev = await prisma.$queryRawUnsafe(`SELECT "processedAt", "tenantId", payload->>'event' ev, payload->'data'->'buyer'->>'email' email, payload->'data'->'product'->>'name' prod, payload->'data'->'subscription'->'plan'->>'name' plan, payload->'data'->'purchase'->>'transaction' tx FROM "HotmartWebhookEvent" WHERE "processedAt" > now() - interval '48 hours' AND payload->>'event' IN ('PURCHASE_APPROVED','PURCHASE_COMPLETE') ORDER BY "processedAt" DESC LIMIT 15`);
  for (const e of ev) {
    const ing = await prisma.incomeRecord.findFirst({ where: { externalTxId: e.tx }, select: { category: true, status: true, grossUsd: true, tenantId: true, businessGroupId: true, saleDate: true } });
    const pend = await prisma.pendingHotmartPayment.findFirst({ where: { transactionId: e.tx }, select: { consumedAt: true } });
    console.log(hora(e.processedAt), e.ev, e.email, '|', e.prod, '|', e.plan ?? '—', '| negocio:', e.tenantId ? 'sí' : 'NO', '| pendiente:', pend ? (pend.consumedAt ? 'activado' : 'SIN ACTIVAR') : '—', '| ingreso:', ing ? `${ing.category} ${ing.status} ${Number(ing.grossUsd)} ${ing.tenantId || ing.businessGroupId ? 'con negocio' : 'SIN negocio'}` : 'NO');
  }

  console.log('== SOLICITUDES DE PAGO MANUAL ==');
  const sol = await prisma.manualPaymentRequest.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 48 * 3600e3) } },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: { createdAt: true, status: true, brandName: true, closerName: true, planPeriodicity: true, amount: true, currency: true, amountUsd: true, createdTenantId: true, reviewedAt: true, lastError: true },
  });
  for (const s of sol) {
    console.log(hora(s.createdAt), s.status, s.brandName, '|', s.closerName, '|', s.planPeriodicity, Number(s.amount), s.currency, '| revisada:', hora(s.reviewedAt), '| negocio:', s.createdTenantId ? 'sí' : 'NO', s.lastError ? `| ERROR: ${s.lastError.slice(0, 120)}` : '');
  }

  console.log('== LO QUE VE EL MURO (últimos ingresos) ==');
  const ing = await prisma.incomeRecord.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 48 * 3600e3) } },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: { createdAt: true, saleDate: true, category: true, status: true, brandName: true, grossUsd: true, tenantId: true, businessGroupId: true },
  });
  for (const r of ing) {
    const entra = r.status === 'PAGADO' && ['NUEVA', 'RENOVACION', 'UPGRADE'].includes(r.category) && (r.tenantId || r.businessGroupId);
    console.log(hora(r.createdAt), r.category, r.status, r.brandName ?? '—', Number(r.grossUsd), '| muro:', entra ? 'sí' : 'NO');
  }
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
