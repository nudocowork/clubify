// Segundo arqueo: los huecos concretos de septiembre.
//
// El primero (arqueo-contabilidad-2026-09.cjs) dijo QUÉ falta en bloque. Este
// mira caso por caso: los 5 negocios que cobraron en septiembre y no tienen
// ingreso, las 2 transacciones de Hotmart que no llegaron al libro y los 5
// `invoice.payment_succeeded` de Stripe.
//
// No escribe nada.
// Uso: railway run --service Postgres-Nq8w node scripts/arqueo-contabilidad-huecos.cjs
const { PrismaClient } = require('@prisma/client');

const usd = (n) => '$ ' + (Math.round(Number(n || 0) * 100) / 100).toFixed(2);

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const ingresos = await prisma.incomeRecord.findMany({
    select: { gateway: true, externalTxId: true, tenantId: true, grossUsd: true, saleDate: true },
  });
  const enLibro = new Set(ingresos.map((i) => i.gateway + '|' + i.externalTxId));

  // ── A. Los negocios de septiembre sin ingreso ──────────────────────────────
  const nombres = ['Chillin Sports & Wings', 'Slata', 'BLIC', 'Moa café ca', 'Oh! Cookies'];
  console.log('════════ A. LOS 5 NEGOCIOS DE SEPTIEMBRE SIN INGRESO\n');
  for (const nombre of nombres) {
    const t = await prisma.tenant.findFirst({
      where: { brandName: nombre, deletedAt: null },
      select: {
        id: true, brandName: true, status: true, createdAt: true, purchasedAt: true,
        lastChargeAt: true, currentPeriodEnd: true, planPeriodicity: true,
        subscriptionPriceUsd: true, lastPaymentAmountUsd: true,
        hotmartTransactionId: true, stripeSubscriptionId: true, planId: true,
        trialEndsAt: true,
      },
    });
    if (!t) { console.log(`  ${nombre}: NO ENCONTRADO`); continue; }
    console.log(`  ${t.brandName}  [${t.status}]`);
    console.log(`    alta ${String(t.createdAt).slice(0, 10)} · compra ${String(t.purchasedAt).slice(0, 10)} · ` +
      `cobro ${String(t.lastChargeAt).slice(0, 10)} · próximo ${String(t.currentPeriodEnd).slice(0, 10)}`);
    console.log(`    plan ${t.planId || '—'} ${t.planPeriodicity || '—'} · precio ${usd(t.subscriptionPriceUsd)} · ` +
      `último pago ${usd(t.lastPaymentAmountUsd)} · prueba hasta ${String(t.trialEndsAt).slice(0, 10)}`);
    console.log(`    hotmartTx=${t.hotmartTransactionId || '—'} stripeSub=${t.stripeSubscriptionId || '—'}`);
    const ev = await prisma.hotmartWebhookEvent.findMany({
      where: { tenantId: t.id },
      select: { eventType: true, processedAt: true, payload: true },
      orderBy: { processedAt: 'asc' },
    });
    for (const e of ev) {
      const c = e.payload?.data?.purchase || {};
      console.log(`      ${String(e.processedAt).slice(0, 10)} ${e.eventType.padEnd(26)} ` +
        `tx=${c.transaction || '—'} ${c.price?.value ?? '?'} ${c.price?.currency_value ?? ''} ` +
        `${enLibro.has('HOTMART|' + c.transaction) ? '✔ en libro' : '✘ NO está en el libro'}`);
    }
    const mp = await prisma.manualPayment.findMany({
      where: { tenantId: t.id }, select: { id: true, amount: true, paidAt: true, method: true },
    });
    for (const m of mp) console.log(`      MANUAL ${String(m.paidAt).slice(0, 10)} ${usd(m.amount)} ${m.method}`);
    console.log('');
  }

  // ── B. Las 2 transacciones de Hotmart que faltan, con su payload ──────────
  console.log('════════ B. LAS TRANSACCIONES DE HOTMART QUE NO LLEGARON AL LIBRO\n');
  for (const tx of ['HP2209512687', 'HP4086347797']) {
    const evs = await prisma.hotmartWebhookEvent.findMany({
      select: { eventType: true, tenantId: true, payload: true, processedAt: true },
    });
    const mios = evs.filter((e) => e.payload?.data?.purchase?.transaction === tx);
    for (const e of mios) {
      const d = e.payload?.data || {};
      const c = d.purchase || {};
      console.log(`  ${tx} · ${e.eventType} · ${String(e.processedAt).slice(0, 19)}`);
      console.log(`    producto ${d.product?.id} "${d.product?.name}" · oferta ${c.offer?.code || '—'}`);
      console.log(`    price ${c.price?.value} ${c.price?.currency_value} · full ${c.full_price?.value} ${c.full_price?.currency_value}`);
      console.log(`    recurrencia ${c.recurrence_number ?? '—'} · plan "${d.subscription?.plan?.name || '—'}" · ` +
        `sub ${d.subscription?.subscriber?.code || '—'} status ${d.subscription?.status || '—'}`);
      console.log(`    comprador ${d.buyer?.email} · tenantId del evento: ${e.tenantId || 'NINGUNO'}`);
      console.log(`    approved_date ${c.approved_date ? new Date(c.approved_date).toISOString() : '—'}`);
      const t = d.buyer?.email
        ? await prisma.tenant.findFirst({
            where: { OR: [{ email: d.buyer.email }, { hotmartSubscriberCode: d.subscription?.subscriber?.code ?? "@@" }, { hotmartTransactionId: tx }], deletedAt: null },
            select: { id: true, brandName: true, whiteLabelId: true, status: true, planId: true, planPeriodicity: true },
          })
        : null;
      console.log(`    negocio que le corresponde: ${t ? `${t.brandName} (${t.id}) plan=${t.planId} ${t.planPeriodicity}` : 'NO RESUELTO'}`);
      console.log('');
    }
  }

  // ── C. Stripe: los cobros con éxito vs el libro ───────────────────────────
  console.log('════════ C. STRIPE — COBROS CON ÉXITO\n');
  const st = await prisma.stripeWebhookEvent.findMany({
    where: { eventType: { in: ['invoice.payment_succeeded', 'invoice.paid', 'charge.succeeded'] } },
    select: { eventId: true, eventType: true, tenantId: true, payload: true, processedAt: true },
    orderBy: { processedAt: 'asc' },
  });
  for (const e of st) {
    const o = e.payload?.data?.object || {};
    const total = o.amount_paid ?? o.amount ?? o.total ?? null;
    const ref = o.id || e.eventId;
    console.log(`  ${String(e.processedAt).slice(0, 10)} ${e.eventType.padEnd(26)} ${ref} ` +
      `${total != null ? (total / 100).toFixed(2) : '?'} ${(o.currency || '').toUpperCase()} ` +
      `tenant=${e.tenantId || '—'} ${enLibro.has('STRIPE|' + ref) ? '✔ en libro' : '✘ no'}`);
  }
  const stripeEnLibro = ingresos.filter((i) => i.gateway === 'STRIPE');
  console.log(`\n  IncomeRecord con gateway STRIPE: ${stripeEnLibro.length}`);
  for (const i of stripeEnLibro) {
    console.log(`    ${String(i.saleDate).slice(0, 10)} tx=${i.externalTxId} ${usd(i.grossUsd)}`);
  }

  // ── D. Septiembre, fila por fila, como lo ve hoy el módulo ────────────────
  console.log('\n════════ D. SEPTIEMBRE 2026 — LAS 20 FILAS DEL LIBRO\n');
  const sept = await prisma.incomeRecord.findMany({
    where: { saleDate: { gte: new Date('2026-09-01T05:00:00Z'), lte: new Date('2026-10-01T04:59:59.999Z') } },
    select: {
      saleDate: true, gateway: true, externalTxId: true, brandName: true, whiteLabelId: true,
      grossUsd: true, netExpectedUsd: true, isFirstPayment: true, productName: true,
      planPeriodicity: true, reconStatus: true, tenantId: true,
    },
    orderBy: { saleDate: 'asc' },
  });
  const wl = await prisma.whiteLabel.findMany({ select: { id: true, slug: true } });
  const slug = new Map(wl.map((w) => [w.id, w.slug]));
  let bruto = 0;
  for (const i of sept) {
    bruto += Number(i.grossUsd);
    console.log(`  ${String(i.saleDate).slice(0, 10)} ${i.gateway.padEnd(7)} ${usd(i.grossUsd).padStart(9)} ` +
      `${(i.brandName || i.productName || '—').slice(0, 26).padEnd(26)} ` +
      `${(i.whiteLabelId ? slug.get(i.whiteLabelId) : 'NULL').padEnd(8)} ` +
      `${i.isFirstPayment ? 'nueva' : 'renov'} ${i.planPeriodicity || '—'}`);
  }
  console.log(`\n  TOTAL septiembre: ${sept.length} filas · ${usd(bruto)}`);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
