// SOLO LECTURA: qué evidencia REAL existe de los cobros de mayo y de la
// primera quincena de junio de 2026, que Contabilidad no tiene.
//
// El 2026-09-07 se concluyó que «mayo no se puede reconstruir desde la base»
// mirando solo `HotmartWebhookEvent` (empieza el 14-jun). Pero Comisiones sí
// enseña fechas de mayo, así que ALGO quedó. Este arqueo cruza todas las
// tablas que pueden guardar rastro de un cobro y, para cada negocio de esa
// ventana, dice qué se sabe y de dónde sale — hecho o inferencia.
//
// No escribe nada.
// Uso: railway run --service Postgres-Nq8w node scripts/arqueo-contabilidad-mayo-fuentes.cjs
const { PrismaClient } = require('@prisma/client');

/** Desde cuándo hay crudo de Hotmart en el libro; antes de esto está el hueco. */
const INICIO_DEL_LIBRO = new Date('2026-06-14T00:00:00.000Z');
/** Un poco antes del hueco, para ver también lo que hay «alrededor». */
const DESDE = new Date('2026-05-01T00:00:00.000Z');

const d10 = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '—');
const mes = (x) => new Date(x).toISOString().slice(0, 7);
const usd = (n) => (n == null ? '—' : '$' + (Math.round(Number(n) * 100) / 100).toFixed(2));
const suma = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    // ── 1. El libro: qué hay y desde cuándo ────────────────────────────────
    const libro = await p.incomeRecord.findMany({
      select: {
        id: true, gateway: true, externalTxId: true, tenantId: true, brandName: true,
        grossUsd: true, saleDate: true, periodKey: true, status: true, category: true,
        whiteLabelId: true, note: true, createdAt: true,
      },
      orderBy: { saleDate: 'asc' },
    });
    console.log('════════ 1. IncomeRecord (el libro)');
    console.log(`  filas: ${libro.length} · primera saleDate: ${d10(libro[0]?.saleDate)}`);
    const porMes = new Map(), brutoMes = new Map();
    for (const r of libro) {
      if (r.status !== 'PAGADO') continue;
      suma(porMes, r.periodKey ?? mes(r.saleDate));
      suma(brutoMes, r.periodKey ?? mes(r.saleDate), Number(r.grossUsd));
    }
    for (const m of [...porMes.keys()].sort()) {
      console.log(`    ${m}  ${String(porMes.get(m)).padStart(4)} cobros  ${usd(brutoMes.get(m)).padStart(11)}`);
    }
    const relleno = libro.filter((r) => /^backfill[-_]/i.test(r.externalTxId));
    console.log(`  filas de relleno (externalTxId backfill-*): ${relleno.length}`);
    for (const r of relleno) console.log(`    ${d10(r.saleDate)} ${r.gateway} ${usd(r.grossUsd)} ${r.brandName ?? '—'} tx=${r.externalTxId} [${r.status}]`);
    const antesDelLibro = libro.filter((r) => r.saleDate < INICIO_DEL_LIBRO);
    console.log(`  filas con saleDate anterior al 14-jun: ${antesDelLibro.length}`);
    for (const r of antesDelLibro) console.log(`    ${d10(r.saleDate)} ${r.gateway} ${usd(r.grossUsd)} ${r.brandName ?? '—'} tx=${r.externalTxId} [${r.status}] nota=${(r.note ?? '').slice(0, 80)}`);

    // ── 2. Crudos de pasarela: desde cuándo existe cada uno ────────────────
    console.log('\n════════ 2. Crudos de pasarela: desde cuándo hay');
    const hw = await p.hotmartWebhookEvent.findMany({
      select: { eventType: true, processedAt: true, tenantId: true, payload: true },
      orderBy: { processedAt: 'asc' },
    });
    console.log(`  HotmartWebhookEvent: ${hw.length} · primero ${d10(hw[0]?.processedAt)}`);
    // ¿Algún payload trae approved_date ANTERIOR al 14-jun? (reenvíos tardíos)
    const aprobadosViejos = hw
      .map((e) => {
        const c = e.payload?.data?.purchase ?? {};
        const ad = typeof c.approved_date === 'number' ? new Date(c.approved_date) : null;
        return { e, c, ad };
      })
      .filter((x) => /PURCHASE_APPROVED|PURCHASE_COMPLETE/.test(x.e.eventType) && x.ad && x.ad < INICIO_DEL_LIBRO);
    console.log(`  …de esos, cobros aprobados con approved_date ANTERIOR al 14-jun: ${aprobadosViejos.length}`);
    for (const x of aprobadosViejos) {
      console.log(`    approved ${d10(x.ad)} procesado ${d10(x.e.processedAt)} ${x.e.eventType} tx=${x.c.transaction} ` +
        `${x.c.price?.value ?? '?'} ${x.c.price?.currency_value ?? ''} rec=${x.c.recurrence_number ?? '?'} ` +
        `buyer=${x.e.payload?.data?.buyer?.email ?? '—'} plan=${x.e.payload?.data?.subscription?.plan?.name ?? '—'}`);
    }

    const ph = await p.pendingHotmartPayment.findMany({ orderBy: { createdAt: 'asc' } });
    console.log(`\n  PendingHotmartPayment: ${ph.length} · primero ${d10(ph[0]?.createdAt)}`);
    const phViejos = ph
      .map((r) => {
        const c = r.rawPayload?.data?.purchase ?? {};
        const ad = typeof c.approved_date === 'number' ? new Date(c.approved_date) : null;
        return { r, c, ad };
      })
      .filter((x) => (x.ad && x.ad < INICIO_DEL_LIBRO) || x.r.createdAt < INICIO_DEL_LIBRO);
    console.log(`  …con approved_date o createdAt anterior al 14-jun: ${phViejos.length}`);
    for (const x of phViejos) {
      console.log(`    approved ${d10(x.ad)} creado ${d10(x.r.createdAt)} ${x.r.event} tx=${x.r.transactionId ?? x.c.transaction ?? '—'} ` +
        `sub=${x.r.subscriberCode ?? '—'} ${x.c.price?.value ?? '?'} ${x.c.price?.currency_value ?? ''} ` +
        `rec=${x.c.recurrence_number ?? '?'} email=${x.r.email} consumido=${d10(x.r.consumedAt)} ` +
        `plan=${x.r.rawPayload?.data?.subscription?.plan?.name ?? '—'} prod=${x.r.rawPayload?.data?.product?.id ?? '—'}`);
    }

    const sw = await p.stripeWebhookEvent.findMany({ select: { processedAt: true, eventType: true }, orderBy: { processedAt: 'asc' }, take: 1 });
    console.log(`\n  StripeWebhookEvent: primero ${d10(sw[0]?.processedAt)} (${sw[0]?.eventType ?? '—'})`);
    const ct = await p.crossTransaction.findMany({ select: { createdAt: true }, orderBy: { createdAt: 'asc' }, take: 1 });
    console.log(`  CrossTransaction: primero ${d10(ct[0]?.createdAt)}`);
    const mp = await p.manualPayment.findMany({ orderBy: { paidAt: 'asc' } });
    console.log(`  ManualPayment: ${mp.length}`);
    for (const m of mp) console.log(`    ${d10(m.paidAt)} ${usd(m.amount)} ${m.currency ?? ''} tenant=${m.tenantId} ${m.method ?? ''} ${m.periodicity ?? ''}`);
    const cp = await p.hotmartCreditPurchase.findMany({ select: { transactionId: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 1 });
    console.log(`  HotmartCreditPurchase: primero ${d10(cp[0]?.createdAt)}`);

    // ── 3. Comisiones fechadas antes del 14-jun ────────────────────────────
    console.log('\n════════ 3. Comisiones con fecha anterior al 14-jun (SOLO LECTURA)');
    const coms = await p.commission.findMany({
      where: {
        status: { not: 'REJECTED' },
        OR: [
          { businessDate: { lt: INICIO_DEL_LIBRO } },
          { businessDate: null, createdAt: { lt: INICIO_DEL_LIBRO } },
        ],
      },
      select: {
        id: true, amount: true, status: true, businessDate: true, createdAt: true, periodKey: true,
        externalTxId: true, hotmartTransactionId: true, baseAmountUsd: true, appliedPercent: true,
        distributionMode: true, businessGroupId: true,
        recipientCode: { select: { code: true, role: true, ownerName: true } },
        referralUse: { select: { id: true, tenantId: true, createdAt: true, convertedAt: true, status: true,
          tenant: { select: { brandName: true } } } },
      },
      orderBy: [{ businessDate: 'asc' }, { createdAt: 'asc' }],
    });
    console.log(`  comisiones: ${coms.length}`);
    for (const c of coms) {
      console.log(`    fecha ${d10(c.businessDate)}${c.businessDate ? '' : '(null→createdAt)'} creada ${d10(c.createdAt)} periodo ${c.periodKey ?? '—'} ` +
        `${usd(c.amount)} base=${usd(c.baseAmountUsd)} ${c.appliedPercent ?? '—'}% ${c.distributionMode ?? '—'} [${c.status}] ` +
        `tx=${c.externalTxId ?? '—'} htx=${c.hotmartTransactionId ?? '—'} ` +
        `→ ${c.referralUse?.tenant?.brandName ?? (c.businessGroupId ? 'GRUPO ' + c.businessGroupId : '—')} ` +
        `(${c.recipientCode?.role ?? '—'} ${c.recipientCode?.code ?? '—'}) use.convertedAt=${d10(c.referralUse?.convertedAt)}`);
    }

    // ── 4. Negocios de la ventana: todo lo que se sabe de cada uno ─────────
    console.log('\n════════ 4. Negocios con alta, compra o cobro anterior al 14-jun');
    const tenants = await p.tenant.findMany({
      where: {
        OR: [
          { createdAt: { lt: INICIO_DEL_LIBRO } },
          { purchasedAt: { lt: INICIO_DEL_LIBRO } },
          { lastChargeAt: { lt: INICIO_DEL_LIBRO } },
        ],
      },
      select: {
        id: true, brandName: true, status: true, createdAt: true, purchasedAt: true, lastChargeAt: true,
        lastPaymentAmountUsd: true, planPeriodicity: true, subscriptionPriceUsd: true, planId: true,
        hotmartTransactionId: true, hotmartSubscriberCode: true, stripeSubscriptionId: true,
        stripeCustomerId: true, whiteLabelId: true, currentPeriodEnd: true, trialEndsAt: true,
        trialStartedAt: true, deletedAt: true, email: true, businessGroupId: true,
        referralUses: { select: { createdAt: true, convertedAt: true, status: true,
          referralCode: { select: { code: true, role: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`  negocios: ${tenants.length}`);
    const ingresosPorTenant = new Map();
    for (const r of libro) {
      if (!r.tenantId) continue;
      if (!ingresosPorTenant.has(r.tenantId)) ingresosPorTenant.set(r.tenantId, []);
      ingresosPorTenant.get(r.tenantId).push(r);
    }
    const comsPorTenant = new Map();
    const todasComs = await p.commission.findMany({
      where: { status: { not: 'REJECTED' } },
      select: { businessDate: true, createdAt: true, amount: true, baseAmountUsd: true, periodKey: true,
        externalTxId: true, hotmartTransactionId: true, referralUse: { select: { tenantId: true } } },
    });
    for (const c of todasComs) {
      const t = c.referralUse?.tenantId; if (!t) continue;
      if (!comsPorTenant.has(t)) comsPorTenant.set(t, []);
      comsPorTenant.get(t).push(c);
    }
    const hwPorTenant = new Map();
    for (const e of hw) {
      if (!e.tenantId) continue;
      if (!hwPorTenant.has(e.tenantId)) hwPorTenant.set(e.tenantId, []);
      hwPorTenant.get(e.tenantId).push(e);
    }
    for (const t of tenants) {
      const ing = (ingresosPorTenant.get(t.id) ?? []).sort((a, b) => a.saleDate - b.saleDate);
      const cs = (comsPorTenant.get(t.id) ?? []).sort((a, b) => new Date(a.businessDate ?? a.createdAt) - new Date(b.businessDate ?? b.createdAt));
      const evs = (hwPorTenant.get(t.id) ?? []);
      console.log(`\n  ${t.brandName}  [${t.status}${t.deletedAt ? ' · BORRADO' : ''}]  id=${t.id}  wl=${t.whiteLabelId ?? 'null'}${t.businessGroupId ? ' grupo=' + t.businessGroupId : ''}`);
      console.log(`    alta ${d10(t.createdAt)} · compra ${d10(t.purchasedAt)} · últimoCobro ${d10(t.lastChargeAt)} · próximo ${d10(t.currentPeriodEnd)} · prueba ${d10(t.trialStartedAt)}→${d10(t.trialEndsAt)}`);
      console.log(`    plan ${t.planId ?? '—'} ${t.planPeriodicity ?? '—'} · precio pactado ${usd(t.subscriptionPriceUsd)} · último pago ${usd(t.lastPaymentAmountUsd)}`);
      console.log(`    hotmartTx=${t.hotmartTransactionId ?? '—'} sub=${t.hotmartSubscriberCode ?? '—'} stripeSub=${t.stripeSubscriptionId ?? '—'} email=${t.email}`);
      for (const u of t.referralUses) console.log(`    referralUse ${u.status} creado ${d10(u.createdAt)} convertido ${d10(u.convertedAt)} (${u.referralCode?.role} ${u.referralCode?.code})`);
      console.log(`    comisiones (${cs.length}): ` + cs.map((c) => `${d10(c.businessDate ?? c.createdAt)}${c.businessDate ? '' : '*'}:${usd(c.amount)}/base ${usd(c.baseAmountUsd)}${c.hotmartTransactionId ? '/htx ' + c.hotmartTransactionId : ''}`).join(' · '));
      console.log(`    ingresos en libro (${ing.length}): ` + ing.map((r) => `${d10(r.saleDate)}:${usd(r.grossUsd)}[${r.status}]${/^backfill/i.test(r.externalTxId) ? '(relleno)' : ''}`).join(' · '));
      console.log(`    webhooks Hotmart (${evs.length}): ` + evs.slice(0, 6).map((e) => `${d10(e.processedAt)}:${e.eventType}`).join(' · ') + (evs.length > 6 ? ' …' : ''));
    }

    // ── 5. AuditLog: ¿hay rastro de mayo? ──────────────────────────────────
    console.log('\n════════ 5. AuditLog en la ventana (solo para saber si hay rastro)');
    try {
      const al = await p.auditLog.findMany({
        where: { createdAt: { gte: DESDE, lt: INICIO_DEL_LIBRO } },
        orderBy: { createdAt: 'asc' },
        take: 60,
      });
      const total = await p.auditLog.count({ where: { createdAt: { gte: DESDE, lt: INICIO_DEL_LIBRO } } });
      console.log(`  entradas entre 01-may y 14-jun: ${total}`);
      for (const a of al) console.log(`    ${d10(a.createdAt)} ${JSON.stringify(a).slice(0, 220)}`);
    } catch (e) { console.log('  (AuditLog no se pudo leer: ' + e.message.split('\n')[0] + ')'); }

    // ── 6. Notification / MessageLog de cobro en la ventana ────────────────
    console.log('\n════════ 6. Otros rastros en la ventana');
    try {
      const n = await p.notification.count({ where: { createdAt: { gte: DESDE, lt: INICIO_DEL_LIBRO } } });
      const n1 = await p.notification.findMany({ where: { createdAt: { gte: DESDE, lt: INICIO_DEL_LIBRO } }, orderBy: { createdAt: 'asc' }, take: 15 });
      console.log(`  Notification entre 01-may y 14-jun: ${n}`);
      for (const x of n1) console.log(`    ${d10(x.createdAt)} ${JSON.stringify(x).slice(0, 200)}`);
    } catch (e) { console.log('  (Notification: ' + e.message.split('\n')[0] + ')'); }
    try {
      const ml = await p.messageLog.findMany({ select: { createdAt: true }, orderBy: { createdAt: 'asc' }, take: 1 });
      console.log(`  MessageLog: primero ${d10(ml[0]?.createdAt)}`);
    } catch (e) { console.log('  (MessageLog: ' + e.message.split('\n')[0] + ')'); }
    try {
      const ru = await p.referralUse.findMany({
        where: { convertedAt: { gte: DESDE, lt: INICIO_DEL_LIBRO } },
        select: { convertedAt: true, createdAt: true, status: true, tenant: { select: { brandName: true } } },
        orderBy: { convertedAt: 'asc' },
      });
      console.log(`  ReferralUse convertidos entre 01-may y 14-jun: ${ru.length}`);
      for (const u of ru) console.log(`    convertido ${d10(u.convertedAt)} creado ${d10(u.createdAt)} ${u.status} ${u.tenant?.brandName ?? '—'}`);
    } catch (e) { console.log('  (ReferralUse: ' + e.message.split('\n')[0] + ')'); }
  } finally {
    await p.$disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
