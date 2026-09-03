// READ-ONLY. ¿Por qué la renovación (mensualidad recobrada) NO generó comisión
// PENDING a los afiliados (nico/sara) para Quipao Bubble Tea, Konnys, Wok Explosivo?
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const now = new Date();

  const names = ['quipao', 'konny', 'wok'];
  const tenants = await prisma.tenant.findMany({
    where: { OR: names.map((n) => ({ brandName: { contains: n, mode: 'insensitive' } })) },
    select: { id: true, brandName: true, slug: true, status: true, planPeriodicity: true,
      subscriptionPriceUsd: true, lastChargeAt: true, currentPeriodEnd: true, createdAt: true },
  });
  console.log(`Encontrados: ${tenants.map((t) => t.brandName).join(', ')}\n`);

  for (const t of tenants) {
    console.log(`\n████ ${t.brandName} | ${t.status} | ${t.planPeriodicity} $${t.subscriptionPriceUsd ?? 'null'}`);
    console.log(`  creado ${d(t.createdAt)} | últ.cobro ${dt(t.lastChargeAt)} | próx ${dt(t.currentPeriodEnd)}`);

    // Atribución
    const uses = await prisma.referralUse.findMany({
      where: { tenantId: t.id },
      select: { id: true, status: true, createdAt: true,
        referralCode: { select: { code: true, role: true, ownerName: true, commissionPercent: true } } },
    });
    console.log(`  Atribución (${uses.length}):`);
    uses.forEach((u) => console.log(`    · ${u.referralCode?.code} [${u.referralCode?.role}] ${u.referralCode?.ownerName} ${u.referralCode?.commissionPercent}% | use ${u.status}`));

    // Comisiones (todas, ordenadas)
    const comms = await prisma.commission.findMany({
      where: { referralUse: { tenantId: t.id } },
      select: { id: true, amount: true, status: true, periodKey: true, createdAt: true, availableAt: true,
        recipientCode: { select: { code: true, ownerName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    console.log(`  Comisiones (${comms.length}):`);
    comms.slice(0, 12).forEach((c) => console.log(`    · $${c.amount} ${c.status} | ${c.recipientCode?.ownerName || c.recipientCode?.code || '∅'} | period=${c.periodKey || '—'} | creada ${dt(c.createdAt)}`));

    // ¿El último cobro tiene comisión con periodKey de ese ciclo?
    if (t.lastChargeAt) {
      const pk = t.lastChargeAt.toISOString().slice(0, 7); // YYYY-MM aprox
      const matchLast = comms.filter((c) => c.createdAt >= new Date(t.lastChargeAt.getTime() - 3 * 86400000));
      console.log(`  → Comisiones creadas alrededor del último cobro (${dt(t.lastChargeAt)}): ${matchLast.length}`);
      if (matchLast.length === 0) console.log('    ⚠️ NINGUNA comisión nueva tras el último cobro → recurrencia NO generó comisión');
    }
  }

  // ¿Existe cron reconcile? Ver últimas comisiones globales para saber si el sistema genera algo hoy
  const recent = await prisma.commission.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - 3 * 86400000) } },
    select: { amount: true, createdAt: true, referralUse: { select: { tenant: { select: { brandName: true } } } } },
    orderBy: { createdAt: 'desc' }, take: 15,
  });
  console.log(`\n\n=== Comisiones creadas en las últimas 72h (global): ${recent.length} ===`);
  recent.forEach((c) => console.log(`  ${dt(c.createdAt)} | $${c.amount} | ${c.referralUse?.tenant?.brandName || 'grupo/otro'}`));

  await prisma.$disconnect(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
function d(x){return x?new Date(x).toISOString().slice(0,10):'—';}
function dt(x){return x?new Date(x).toISOString().slice(0,16).replace('T',' '):'—';}
