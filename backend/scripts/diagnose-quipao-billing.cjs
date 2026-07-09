// Diagnóstico (y corrección opcional) del bug de cobro PDF734.
// Read-only por defecto: imprime el estado de billing de los tenants que
// matcheen QUIPAO (o el patrón PATTERN=...). Con APPLY=1 corrige los que
// estén "pagados con fecha vieja" (paidButStale): avanza currentPeriodEnd a
// (lastChargeAt + período), limpia failedPaymentCount y resetea flags.
// Usage:
//   railway run --service Postgres-Nq8w node backend/scripts/diagnose-quipao-billing.cjs
//   APPLY=1 railway run --service Postgres-Nq8w node backend/scripts/diagnose-quipao-billing.cjs
const { PrismaClient } = require('@prisma/client');

function bundleMonths(p) {
  switch ((p || 'MENSUAL').toUpperCase()) {
    case 'TRIMESTRAL': return 3;
    case 'SEMESTRAL': return 6;
    case 'ANUAL': return 12;
    default: return 1;
  }
}
function addPlanPeriod(from, p) {
  const d = new Date(from);
  d.setMonth(d.getMonth() + bundleMonths(p));
  return d;
}
function paidButStale(t) {
  if (!t.lastChargeAt || !t.currentPeriodEnd) return false;
  if (t.lastChargeAt.getTime() >= t.currentPeriodEnd.getTime()) return true;
  const dayMs = 86400000;
  const expectedNext = addPlanPeriod(t.lastChargeAt, t.planPeriodicity);
  return t.currentPeriodEnd.getTime() < expectedNext.getTime() - 2 * dayMs;
}
// Preserva el día de cobro: avanza por períodos completos hasta un ciclo real
// después del último pago y en el futuro (espejo de billing.service).
function nextChargeAfterPayment(now, t) {
  const dayMs = 86400000;
  const p = t.planPeriodicity;
  const expectedNext = t.lastChargeAt ? addPlanPeriod(t.lastChargeAt, p) : addPlanPeriod(now, p);
  let next = new Date(t.currentPeriodEnd || expectedNext);
  let guard = 0;
  while (next.getTime() < expectedNext.getTime() - 2 * dayMs && guard++ < 120) next = addPlanPeriod(next, p);
  while (next.getTime() <= now.getTime() && guard++ < 240) next = addPlanPeriod(next, p);
  return next;
}
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const pattern = (process.env.PATTERN || 'quipao').toLowerCase();
  const apply = process.env.APPLY === '1';

  const tenants = await prisma.tenant.findMany({
    where: { brandName: { contains: pattern, mode: 'insensitive' } },
    select: {
      id: true, brandName: true, status: true, planPeriodicity: true,
      currentPeriodEnd: true, lastChargeAt: true, lastPaymentAttemptAt: true,
      failedPaymentCount: true, paymentReminderSentFor: true,
      pausePendingNoticeSentAt: true, whiteLabelId: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (!tenants.length) { console.log(`Sin tenants para "${pattern}".`); await prisma.$disconnect(); return; }

  const now = new Date();
  for (const t of tenants) {
    const stale = paidButStale(t);
    const expectedNext = stale ? nextChargeAfterPayment(now, t) : null;
    console.log('────────────────────────────────────────────');
    console.log(`${t.brandName}  (${t.id})  wl=${t.whiteLabelId ?? 'null'}`);
    console.log(`  status=${t.status}  plan=${t.planPeriodicity ?? 'MENSUAL'}`);
    console.log(`  currentPeriodEnd (próx. cobro)= ${iso(t.currentPeriodEnd)}`);
    console.log(`  lastChargeAt (último pago)    = ${iso(t.lastChargeAt)}`);
    console.log(`  lastPaymentAttemptAt          = ${iso(t.lastPaymentAttemptAt)}`);
    console.log(`  failedPaymentCount            = ${t.failedPaymentCount}`);
    console.log(`  paymentReminderSentFor        = ${iso(t.paymentReminderSentFor)}`);
    console.log(`  pausePendingNoticeSentAt      = ${iso(t.pausePendingNoticeSentAt)}`);
    console.log(`  → paidButStale = ${stale ? 'SÍ (pagado, fecha vieja)' : 'no'}` +
      (expectedNext ? `  | esperado próx.cobro = ${iso(expectedNext)}` : ''));

    if (stale && apply) {
      await prisma.tenant.update({
        where: { id: t.id },
        data: {
          currentPeriodEnd: expectedNext,
          failedPaymentCount: 0,
          lastPaymentAttemptAt: t.lastChargeAt,
          paymentReminderSentFor: null,
          pausePendingNoticeSentAt: null,
        },
      });
      console.log(`  ✅ CORREGIDO → currentPeriodEnd=${iso(expectedNext)}, failedPaymentCount=0, flags reseteados.`);
    } else if (stale) {
      console.log('  (dry-run) Correr con APPLY=1 para corregir.');
    }
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
