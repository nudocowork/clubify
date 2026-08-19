// Backfill de Tenant.purchasedAt (PDF Soft 10) para negocios EXISTENTES (null).
// Fuente: el approved_date REAL del PendingHotmartPayment del negocio, linkeado
// por transactionId → subscriberCode → email del owner. Solo backdatea (compra
// <= createdAt), nunca forward-datea. DRY-RUN por defecto; --apply para escribir.
//
// Usage (dry-run):  railway run --service Postgres-Nq8w node scripts/backfill-purchased-at.cjs
// Usage (aplicar):  railway run --service Postgres-Nq8w node scripts/backfill-purchased-at.cjs --apply
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const APPLY = process.argv.includes('--apply');

  // 1) Índices de PendingHotmartPayment por tx / subscriber / email → approved_date.
  const pendings = await prisma.pendingHotmartPayment.findMany({
    select: { email: true, subscriberCode: true, transactionId: true, rawPayload: true },
  });
  const approvedOf = (p) => {
    const a = p.rawPayload && p.rawPayload.data && p.rawPayload.data.purchase
      ? p.rawPayload.data.purchase.approved_date
      : null;
    return typeof a === 'number' ? new Date(a) : null; // Hotmart manda epoch ms
  };
  const byTx = new Map(), bySub = new Map(), byEmail = new Map();
  const min = (m, k, d) => { const c = m.get(k); if (!c || d < c) m.set(k, d); };
  for (const p of pendings) {
    const d = approvedOf(p);
    if (!d) continue;
    if (p.transactionId) min(byTx, p.transactionId, d);
    if (p.subscriberCode) min(bySub, p.subscriberCode, d);
    if (p.email) min(byEmail, p.email.toLowerCase(), d);
  }
  console.log(`PendingHotmartPayment con approved_date: ${[...byTx.values()].length ? '' : ''}${byTx.size} tx / ${bySub.size} subscriber / ${byEmail.size} email`);

  // 2) Tenants sin purchasedAt.
  const tenants = await prisma.tenant.findMany({
    where: { purchasedAt: null },
    select: {
      id: true, brandName: true, createdAt: true,
      hotmartTransactionId: true, hotmartSubscriberCode: true,
      users: { where: { role: 'TENANT_OWNER' }, select: { email: true }, take: 1 },
    },
  });

  const plan = [];
  let skippedAfter = 0;
  for (const t of tenants) {
    let d = null, src = null;
    if (t.hotmartTransactionId && byTx.has(t.hotmartTransactionId)) { d = byTx.get(t.hotmartTransactionId); src = 'tx'; }
    else if (t.hotmartSubscriberCode && bySub.has(t.hotmartSubscriberCode)) { d = bySub.get(t.hotmartSubscriberCode); src = 'subscriber'; }
    else {
      const e = t.users[0] && t.users[0].email ? t.users[0].email.toLowerCase() : null;
      if (e && byEmail.has(e)) { d = byEmail.get(e); src = 'email'; }
    }
    if (!d) continue;
    // Solo backdatear: la compra debe ser <= creación de la cuenta (+1 día de
    // tolerancia por zona horaria). Si la "compra" es MUY posterior, es una
    // renovación / mismatch → se descarta.
    if (d.getTime() > t.createdAt.getTime() + 86400000) { skippedAfter++; continue; }
    const diffDays = Math.round((t.createdAt.getTime() - d.getTime()) / 86400000);
    plan.push({ id: t.id, brandName: t.brandName, createdAt: t.createdAt, purchaseDate: d, src, diffDays });
  }

  const iso = (x) => x.toISOString().slice(0, 10);
  console.log(`\nTenants sin purchasedAt: ${tenants.length}`);
  console.log(`Con fecha de compra recuperable (se actualizarían): ${plan.length}`);
  console.log(`Descartados por "compra posterior al registro" (renovación/mismatch): ${skippedAfter}`);

  const notable = plan.filter((p) => p.diffDays >= 2).sort((a, b) => b.diffDays - a.diffDays);
  console.log(`\nDe esos, con >=2 días de diferencia (los "pagó y activó tarde"): ${notable.length}`);
  for (const p of notable.slice(0, 50)) {
    console.log(`  • ${p.brandName}: compra ${iso(p.purchaseDate)}  vs  creado ${iso(p.createdAt)}  (${p.diffDays}d, ${p.src})`);
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] No se escribió NADA. Revisá la lista de arriba.');
    console.log('Para aplicar: agregá --apply al comando.');
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  for (const p of plan) {
    await prisma.tenant.update({ where: { id: p.id }, data: { purchasedAt: p.purchaseDate } });
    updated++;
  }
  console.log(`\n✅ APLICADO: ${updated} negocios actualizados con su fecha real de compra.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
