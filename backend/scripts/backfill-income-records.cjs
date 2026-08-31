// CONTABILIDAD — Backfill del histórico de ingresos (IncomeRecord). Aditivo e
// IDEMPOTENTE (createMany skipDuplicates por (gateway, externalTxId)). No borra
// ni recalcula nada; solo crea las filas que faltan a partir de los datos que YA
// existen. NO toca comisiones. Se puede correr varias veces sin duplicar.
//
//   cd backend
//   export DATABASE_PUBLIC_URL="$(railway variables --service Postgres-Nq8w --json \
//     | python3 -c 'import json,sys;print(json.load(sys.stdin)["DATABASE_PUBLIC_URL"])')"
//   node scripts/backfill-income-records.cjs
//
// Fuentes (montos REALES vs ESTIMADO):
//   1) ManualPayment.amount        → real, gateway MANUAL
//   2) CrossTransaction.amountUsd  → real, gateway CROSS (solo APPROVED)
//   3) Tenant.lastPaymentAmountUsd → ESTIMADO: solo el ÚLTIMO cobro de cada
//      negocio (Hotmart/Stripe no guardan histórico por transacción). Nota lo
//      marca. El histórico real completo empieza desde que corre la Fase 1.
const { PrismaClient } = require('@prisma/client');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

const round2 = (n) => Math.round(n * 100) / 100;
const periodKeyOf = (d) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

(async () => {
  // Tasas configurables (las mismas que usa la captura en vivo).
  const settings = await p.setting.findMany({
    where: { key: { startsWith: 'finance.' } },
  });
  const S = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const feePctOf = (gw) => Number((S[`finance.gatewayFeePct.${gw}`] ?? '0').replace(',', '.')) || 0;
  const taxPct = Number((S['finance.taxPct'] ?? '0').replace(',', '.')) || 0;
  const taxIncluded = (S['finance.taxBase'] ?? 'gross') === 'included';
  const deduct = (gross, gw) => {
    const fee = round2((gross * feePctOf(gw)) / 100);
    const tax = taxIncluded
      ? round2(gross - gross / (1 + taxPct / 100))
      : round2((gross * taxPct) / 100);
    return { fee, tax, net: round2(gross - fee - tax) };
  };

  const rows = [];

  // 1) Pagos manuales (monto real).
  const manuals = await p.manualPayment.findMany({
    where: { amount: { not: null } },
    select: {
      id: true, tenantId: true, whiteLabelId: true, amount: true, currency: true,
      paidAt: true, periodicity: true,
    },
  });
  // Nombre del negocio (snapshot) para las filas manuales/cross.
  const tenantIds = [...new Set(manuals.map((m) => m.tenantId).filter(Boolean))];
  const tMap = new Map();
  if (tenantIds.length) {
    const ts = await p.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, brandName: true },
    });
    ts.forEach((t) => tMap.set(t.id, t.brandName));
  }
  for (const m of manuals) {
    const gross = Number(m.amount);
    if (!(gross > 0)) continue;
    if (m.currency && m.currency.toUpperCase() !== 'USD') continue; // multi-moneda: fase posterior
    const d = deduct(gross, 'MANUAL');
    rows.push({
      gateway: 'MANUAL', externalTxId: m.id, tenantId: m.tenantId,
      whiteLabelId: m.whiteLabelId ?? null, brandName: tMap.get(m.tenantId) ?? null,
      planPeriodicity: m.periodicity ?? null, currency: 'USD', grossUsd: gross,
      gatewayFeeUsd: d.fee, taxUsd: d.tax, otherDiscountUsd: 0, netExpectedUsd: d.net,
      isFirstPayment: false, periodKey: periodKeyOf(m.paidAt), saleDate: m.paidAt,
      reconStatus: 'PENDING', note: 'Backfill · pago manual',
    });
  }

  // 2) CrossPay aprobadas (monto real).
  const cross = await p.crossTransaction.findMany({
    where: { amountUsd: { not: null }, status: 'APPROVED' },
    select: {
      providerRef: true, tenantId: true, whiteLabelId: true, amountUsd: true,
      currency: true, createdAt: true,
    },
  });
  const crossTenantIds = [...new Set(cross.map((c) => c.tenantId).filter(Boolean))];
  if (crossTenantIds.length) {
    const ts = await p.tenant.findMany({
      where: { id: { in: crossTenantIds } },
      select: { id: true, brandName: true },
    });
    ts.forEach((t) => tMap.set(t.id, t.brandName));
  }
  for (const c of cross) {
    const gross = Number(c.amountUsd);
    if (!(gross > 0)) continue;
    if (c.currency && c.currency.toUpperCase() !== 'USD') continue;
    const d = deduct(gross, 'CROSS');
    rows.push({
      gateway: 'CROSS', externalTxId: c.providerRef, tenantId: c.tenantId ?? null,
      whiteLabelId: c.whiteLabelId ?? null, brandName: c.tenantId ? tMap.get(c.tenantId) ?? null : null,
      planPeriodicity: null, currency: 'USD', grossUsd: gross,
      gatewayFeeUsd: d.fee, taxUsd: d.tax, otherDiscountUsd: 0, netExpectedUsd: d.net,
      isFirstPayment: false, periodKey: periodKeyOf(c.createdAt), saleDate: c.createdAt,
      reconStatus: 'PENDING', note: 'Backfill · CrossPay',
    });
  }

  // 3) Último cobro de cada negocio (ESTIMADO — Hotmart/Stripe sin histórico).
  const tenants = await p.tenant.findMany({
    where: { lastPaymentAmountUsd: { not: null }, lastChargeAt: { not: null } },
    select: {
      id: true, brandName: true, whiteLabelId: true, planPeriodicity: true,
      lastPaymentAmountUsd: true, lastChargeAt: true, hotmartTransactionId: true,
      stripeSubscriptionId: true, purchasedAt: true,
    },
  });
  for (const t of tenants) {
    const gross = Number(t.lastPaymentAmountUsd);
    if (!(gross > 0)) continue;
    const gateway = t.hotmartTransactionId ? 'HOTMART' : t.stripeSubscriptionId ? 'STRIPE' : null;
    if (!gateway) continue; // sin pasarela identificable → lo omitimos
    const externalTxId =
      gateway === 'HOTMART' && t.hotmartTransactionId
        ? t.hotmartTransactionId
        : `backfill-last-${t.id}`;
    const d = deduct(gross, gateway);
    rows.push({
      gateway, externalTxId, tenantId: t.id, whiteLabelId: t.whiteLabelId ?? null,
      brandName: t.brandName, planPeriodicity: t.planPeriodicity ?? null, currency: 'USD',
      grossUsd: gross, gatewayFeeUsd: d.fee, taxUsd: d.tax, otherDiscountUsd: 0,
      netExpectedUsd: d.net,
      isFirstPayment: !!(t.purchasedAt && t.lastChargeAt && t.purchasedAt.getTime() === t.lastChargeAt.getTime()),
      periodKey: periodKeyOf(t.lastChargeAt), saleDate: t.lastChargeAt,
      reconStatus: 'PENDING', note: 'Backfill · último cobro (estimado)',
    });
  }

  console.log(`Preparadas ${rows.length} filas (manual ${manuals.length}, cross ${cross.length}, tenants ${tenants.length}).`);
  // Idempotente: skipDuplicates ignora las que ya existen por (gateway, externalTxId).
  let created = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const r = await p.incomeRecord.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
    created += r.count;
  }
  const total = await p.incomeRecord.count();
  console.log(`\n✅ Backfill: ${created} filas nuevas creadas. IncomeRecord ahora tiene ${total} filas.`);
})()
  .catch((e) => {
    console.error('❌ Falló el backfill:', e.message);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
