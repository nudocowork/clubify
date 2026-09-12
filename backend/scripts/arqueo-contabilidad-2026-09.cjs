// Arqueo de Contabilidad: qué hay, qué falta y qué se puede reconstruir.
//
// POR QUÉ: el módulo enseña septiembre casi vacío. Antes de tocar una línea hay
// que saber si el dinero no existe o si existe y no se está viendo. Este script
// NO escribe nada: compara los eventos de cobro de cada pasarela contra
// `IncomeRecord` y dice, transacción por transacción, cuáles no llegaron al
// libro.
//
// Uso: railway run --service Postgres-Nq8w node scripts/arqueo-contabilidad-2026-09.cjs
const { PrismaClient } = require('@prisma/client');

const q2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const usd = (n) => '$ ' + q2(n).toFixed(2);

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const marcas = await prisma.whiteLabel.findMany({ select: { id: true, slug: true } });
  const slugDe = new Map(marcas.map((m) => [m.id, m.slug]));
  const clubifyId = marcas.find((m) => m.slug === 'clubify')?.id ?? null;
  console.log('marca clubify:', clubifyId, '| marcas totales:', marcas.length);

  // ── 1. El libro tal cual está ───────────────────────────────────────────────
  const ingresos = await prisma.incomeRecord.findMany({
    select: {
      id: true, gateway: true, externalTxId: true, tenantId: true,
      whiteLabelId: true, brandName: true, grossUsd: true, netExpectedUsd: true,
      netReceivedUsd: true, reconStatus: true, isFirstPayment: true,
      productName: true, planPeriodicity: true, planId: true,
      periodKey: true, saleDate: true,
    },
    orderBy: { saleDate: 'asc' },
  });
  console.log('\n════════ 1. INCOMERECORD: ' + ingresos.length + ' filas');
  const porMes = new Map();
  for (const i of ingresos) {
    const k = i.periodKey || 'sin periodKey';
    const c = porMes.get(k) || { n: 0, bruto: 0, clubify: 0, nulo: 0, otras: 0 };
    c.n += 1; c.bruto += Number(i.grossUsd);
    if (i.whiteLabelId === clubifyId) c.clubify += 1;
    else if (i.whiteLabelId == null) c.nulo += 1;
    else c.otras += 1;
    porMes.set(k, c);
  }
  console.log('mes        filas     bruto     | marca=clubify  marca=null  otras marcas');
  for (const [k, c] of [...porMes].sort()) {
    console.log(
      `${k.padEnd(10)} ${String(c.n).padStart(5)}  ${usd(c.bruto).padStart(10)} |` +
      `${String(c.clubify).padStart(13)} ${String(c.nulo).padStart(11)} ${String(c.otras).padStart(13)}`,
    );
  }
  const sinPlan = ingresos.filter((i) => !i.planId).length;
  const sinPeriodicidad = ingresos.filter((i) => !i.planPeriodicity).length;
  console.log(`\ncampos vacíos: planId ${sinPlan}/${ingresos.length} · planPeriodicity ${sinPeriodicidad}/${ingresos.length}`);
  console.log('primer ingreso:', ingresos[0]?.saleDate, '· último:', ingresos[ingresos.length - 1]?.saleDate);

  // ── 2. Hotmart: eventos de compra vs libro ─────────────────────────────────
  const hm = await prisma.hotmartWebhookEvent.findMany({
    select: { eventId: true, eventType: true, tenantId: true, payload: true, processedAt: true },
  });
  const tiposHm = new Map();
  for (const e of hm) tiposHm.set(e.eventType, (tiposHm.get(e.eventType) || 0) + 1);
  console.log('\n════════ 2. HOTMART: ' + hm.length + ' eventos');
  console.log([...tiposHm].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}=${n}`).join(' · '));

  const txEnLibro = new Set(ingresos.map((i) => i.gateway + '|' + i.externalTxId));
  const aprobados = hm.filter((e) =>
    /APPROVED|COMPLETE|PURCHASE_BILLET|PURCHASE_PROTEST|PURCHASE_DELAYED/.test(e.eventType) === false
      ? /APPROVED|COMPLETE/.test(e.eventType)
      : /APPROVED|COMPLETE/.test(e.eventType));
  const faltanHm = [];
  for (const e of aprobados) {
    const p = e.payload || {};
    const compra = p?.data?.purchase || {};
    const tx = compra.transaction || p?.data?.purchase?.transaction || null;
    if (!tx) continue;
    if (txEnLibro.has('HOTMART|' + tx)) continue;
    faltanHm.push({
      tx,
      tipo: e.eventType,
      fecha: compra.approved_date ? new Date(compra.approved_date) : e.processedAt,
      producto: p?.data?.product?.id ?? null,
      nombre: p?.data?.product?.name ?? null,
      valor: compra?.price?.value ?? compra?.full_price?.value ?? null,
      moneda: compra?.price?.currency_value ?? compra?.full_price?.currency_value ?? null,
      tenantId: e.tenantId,
      correo: p?.data?.buyer?.email ?? null,
    });
  }
  console.log(`compras aprobadas: ${aprobados.length} · SIN ingreso en el libro: ${faltanHm.length}`);
  for (const f of faltanHm.slice(0, 40)) {
    console.log(`  ${String(f.fecha).slice(0, 10)} tx=${f.tx} prod=${f.producto} ` +
      `${f.valor ?? '?'} ${f.moneda ?? ''} · ${f.correo ?? 'sin correo'} · ${f.tipo}`);
  }
  if (faltanHm.length > 40) console.log(`  … y ${faltanHm.length - 40} más`);

  // ── 3. Stripe y Cross ──────────────────────────────────────────────────────
  const st = await prisma.stripeWebhookEvent.findMany({
    select: { eventId: true, eventType: true, tenantId: true, payload: true, processedAt: true },
  });
  const tiposSt = new Map();
  for (const e of st) tiposSt.set(e.eventType, (tiposSt.get(e.eventType) || 0) + 1);
  console.log('\n════════ 3. STRIPE: ' + st.length + ' eventos');
  console.log([...tiposSt].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}=${n}`).join(' · '));

  const cx = await prisma.crossWebhookEvent.findMany({
    select: { eventId: true, eventType: true, status: true, processedAt: true },
  });
  console.log('CROSS: ' + cx.length + ' eventos');

  // ── 4. Pagos manuales ──────────────────────────────────────────────────────
  const manuales = await prisma.manualPayment.findMany({
    select: { id: true, tenantId: true, amount: true, currency: true, paidAt: true, method: true },
    orderBy: { paidAt: 'asc' },
  });
  const faltanMan = manuales.filter(
    (m) => m.amount != null && Number(m.amount) > 0 &&
      (!m.currency || m.currency.toUpperCase() === 'USD') &&
      !txEnLibro.has('MANUAL|' + m.id),
  );
  console.log('\n════════ 4. PAGOS MANUALES: ' + manuales.length + ' · sin ingreso: ' + faltanMan.length);
  for (const m of faltanMan.slice(0, 30)) {
    console.log(`  ${String(m.paidAt).slice(0, 10)} ${usd(m.amount)} ${m.currency || 'USD'} ${m.method} tenant=${m.tenantId}`);
  }

  // ── 5. Packs de créditos ───────────────────────────────────────────────────
  const packs = await prisma.hotmartCreditPurchase.findMany({
    select: { transactionId: true, credits: true, status: true, createdAt: true, whiteLabelId: true },
    orderBy: { createdAt: 'asc' },
  });
  const faltanPacks = packs.filter((p) => !txEnLibro.has('HOTMART|' + p.transactionId));
  console.log('\n════════ 5. PACKS DE CRÉDITOS: ' + packs.length + ' · sin ingreso: ' + faltanPacks.length);
  for (const p of faltanPacks.slice(0, 30)) {
    console.log(`  ${String(p.createdAt).slice(0, 10)} tx=${p.transactionId} ${p.credits} créditos ${p.status}`);
  }

  // ── 6. Comisiones: generadas vs pagadas ────────────────────────────────────
  const com = await prisma.commission.findMany({
    select: {
      id: true, amount: true, amountPaid: true, status: true, paymentStatus: true,
      businessDate: true, createdAt: true, paidAt: true,
    },
  });
  console.log('\n════════ 6. COMISIONES: ' + com.length + ' filas');
  const ce = new Map();
  for (const c of com) {
    const k = `${c.status} / ${c.paymentStatus}`;
    const o = ce.get(k) || { n: 0, gen: 0, pag: 0 };
    o.n += 1; o.gen += Number(c.amount); o.pag += Number(c.amountPaid || 0);
    ce.set(k, o);
  }
  for (const [k, o] of [...ce].sort()) {
    console.log(`  ${k.padEnd(34)} ${String(o.n).padStart(4)} filas · generado ${usd(o.gen).padStart(11)} · pagado ${usd(o.pag).padStart(11)}`);
  }
  const sinFecha = com.filter((c) => !c.businessDate).length;
  console.log(`  sin businessDate: ${sinFecha}`);

  // ── 7. Egresos / nómina / cierres ──────────────────────────────────────────
  const [nExp, nCat, nRec, nEmp, nRun, nItem, nClose] = await Promise.all([
    prisma.expense.count(), prisma.expenseCategory.count(),
    prisma.recurringExpense.count(), prisma.payrollEmployee.count(),
    prisma.payrollRun.count(), prisma.payrollItem.count(),
    prisma.financialClose.count(),
  ]);
  console.log('\n════════ 7. EGRESOS Y NÓMINA');
  console.log(`  Expense ${nExp} · ExpenseCategory ${nCat} · RecurringExpense ${nRec}`);
  console.log(`  PayrollEmployee ${nEmp} · PayrollRun ${nRun} · PayrollItem ${nItem} · FinancialClose ${nClose}`);

  // ── 8. Negocios que cobraron según el tenant, mirados contra el libro ──────
  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null, lastChargeAt: { not: null } },
    select: {
      id: true, brandName: true, whiteLabelId: true, status: true,
      lastChargeAt: true, currentPeriodEnd: true, lastPaymentAmountUsd: true,
      planPeriodicity: true, subscriptionPriceUsd: true,
    },
    orderBy: { lastChargeAt: 'desc' },
  });
  const conIngreso = new Set(ingresos.map((i) => i.tenantId).filter(Boolean));
  const sinNingunIngreso = tenants.filter((t) => !conIngreso.has(t.id));
  console.log('\n════════ 8. NEGOCIOS CON COBRO REGISTRADO EN EL TENANT');
  console.log(`  con lastChargeAt: ${tenants.length} · de ellos SIN ninguna fila en IncomeRecord: ${sinNingunIngreso.length}`);
  for (const t of sinNingunIngreso.slice(0, 40)) {
    console.log(`  ${String(t.lastChargeAt).slice(0, 10)} ${(t.brandName || '?').slice(0, 28).padEnd(28)} ` +
      `${t.status.padEnd(9)} ${usd(t.lastPaymentAmountUsd).padStart(10)} ${slugDe.get(t.whiteLabelId) || 'sin marca'}`);
  }
  if (sinNingunIngreso.length > 40) console.log(`  … y ${sinNingunIngreso.length - 40} más`);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
