// DIAGNÓSTICO B6 (read-only): comisiones con fechas imposibles / filas fantasma
// que ensucian la heurística del "mínimo" y otros reportes. NO escribe nada.
// Usage: railway run --service Postgres-Nq8w node scripts/diagnose-commission-dates.cjs
const { PrismaClient } = require('@prisma/client');

const HOLD_DAYS = 15;
const DAY = 86400000;
const effAvail = (c) =>
  c.availableAt ? new Date(c.availableAt).getTime()
                : new Date(c.createdAt).getTime() + HOLD_DAYS * DAY;
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '—');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const all = await prisma.commission.findMany({
    select: {
      id: true, status: true, createdAt: true, availableAt: true, paidAt: true,
      businessDate: true, periodKey: true, amount: true,
      referralUse: { select: { tenant: { select: { id: true, brandName: true, createdAt: true, purchasedAt: true } } } },
    },
  });
  console.log(`\nComisiones totales: ${all.length}`);

  // ---- A) Invariantes temporales rotas ----
  const availBeforeCreated = [];
  const paidBeforeCreated = [];
  const paidBeforeAvail = [];
  const ancient = [];         // createdAt de año < 2026
  const beforeTenant = [];    // createdAt anterior a la creación del tenant
  for (const c of all) {
    const created = new Date(c.createdAt).getTime();
    const tCreated = c.referralUse?.tenant?.createdAt
      ? new Date(c.referralUse.tenant.createdAt).getTime() : null;
    const brand = c.referralUse?.tenant?.brandName ?? '(grupo/—)';
    if (c.availableAt && new Date(c.availableAt).getTime() < created)
      availBeforeCreated.push({ brand, created: d(c.createdAt), avail: d(c.availableAt) });
    if (c.paidAt && new Date(c.paidAt).getTime() < created)
      paidBeforeCreated.push({ brand, created: d(c.createdAt), paid: d(c.paidAt) });
    if (c.paidAt && c.availableAt && new Date(c.paidAt).getTime() < new Date(c.availableAt).getTime())
      paidBeforeAvail.push({ brand, avail: d(c.availableAt), paid: d(c.paidAt) });
    if (new Date(c.createdAt).getUTCFullYear() < 2026)
      ancient.push({ brand, created: d(c.createdAt), status: c.status });
    if (tCreated && created < tCreated - DAY)
      beforeTenant.push({ brand, created: d(c.createdAt), tenant: d(c.referralUse.tenant.createdAt) });
  }
  const rep = (title, arr) => {
    console.log(`\n== ${title}: ${arr.length} ==`);
    for (const x of arr.slice(0, 25)) console.log('   ', JSON.stringify(x));
    if (arr.length > 25) console.log(`    …(+${arr.length - 25})`);
  };
  rep('A1 availableAt < createdAt (hold roto)', availBeforeCreated);
  rep('A2 paidAt < createdAt (pagada antes de existir)', paidBeforeCreated);
  rep('A3 paidAt < availableAt (pagada antes de desbloquear)', paidBeforeAvail);
  rep('A4 createdAt año < 2026 (fecha ancestral)', ancient);
  rep('A5 createdAt anterior a la creación del tenant', beforeTenant);

  // ---- B) Fila fantasma que "jala" el mínimo por tenant ----
  const byTenant = new Map();
  for (const c of all) {
    if (c.status === 'REJECTED') continue;
    const tid = c.referralUse?.tenant?.id;
    if (!tid) continue;
    const arr = byTenant.get(tid) ?? [];
    arr.push(c);
    byTenant.set(tid, arr);
  }
  const phantom = [];
  for (const [, arr] of byTenant) {
    if (arr.length < 2) continue;
    const sorted = arr.map((c) => ({ c, ms: effAvail(c) })).sort((a, b) => a.ms - b.ms);
    const gapDays = (sorted[1].ms - sorted[0].ms) / DAY;
    if (gapDays > 20) {
      const brand = sorted[0].c.referralUse?.tenant?.brandName;
      phantom.push({
        brand,
        min: d(sorted[0].c.createdAt),
        siguiente: d(sorted[1].c.createdAt),
        gapDias: Math.round(gapDays),
        periodKeyMin: sorted[0].c.periodKey,
      });
    }
  }
  console.log(`\n== B: tenants donde la 1ª (mín) está >20d antes que la 2ª comisión (posible fantasma) ==`);
  console.log(`   ${phantom.length} tenant(s):`);
  for (const p of phantom) console.log('   ', JSON.stringify(p));

  console.log(`\n[DIAGNÓSTICO] Read-only. No se escribió nada.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
