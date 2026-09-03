// SOLO-LECTURA: diagnóstico del batch (Samuel role · landing plans · Hydor/Quipao billing).
// Usage: railway run --service Postgres-Nq8w node scripts/diagnose-batch-samuel-hydor-quipao.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // #1 — Samuel (rol)
  console.log('=== #1 Samuel (rol) ===');
  const sams = await prisma.user.findMany({
    where: { OR: [{ fullName: { contains: 'samuel', mode: 'insensitive' } }, { email: { contains: 'samuel', mode: 'insensitive' } }] },
    select: { id: true, fullName: true, email: true, role: true, whiteLabelId: true, isActive: true },
  });
  sams.forEach((s) => console.log(`  ${s.fullName} <${s.email}> role=${s.role} wl=${s.whiteLabelId ?? 'null'} active=${s.isActive}`));
  if (!sams.length) console.log('  (no encontré usuario Samuel)');

  // #2 — landing plans (checkoutUrls)
  console.log('\n=== #2 Landing plans (settings) ===');
  const keys = ['mensual', 'trimestral', 'semestral', 'anual'].flatMap((p) => [`landing.plans.${p}.price`, `landing.plans.${p}.checkoutUrl`]);
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  for (const p of ['mensual', 'trimestral', 'semestral', 'anual']) {
    const price = byKey.get(`landing.plans.${p}.price`) ?? '(default)';
    const urlRaw = byKey.get(`landing.plans.${p}.checkoutUrl`) ?? '';
    const url = urlRaw ? urlRaw.replace(/(off=)[^&]+/i, '$1…').slice(0, 70) : '(VACÍO — sin checkout)';
    const hasRef = /[?&]src=/i.test(urlRaw) ? '⚠️ tiene ?src (ref!)' : '';
    console.log(`  ${p}: $${price} · ${url} ${hasRef}`);
  }

  // #3 — Hydor / Quipao billing
  console.log('\n=== #3 Hydor / Quipao (billing) ===');
  for (const q of ['hydor', 'quipao']) {
    const ts = await prisma.tenant.findMany({
      where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { brandName: { contains: q, mode: 'insensitive' } }] },
      select: { id: true, name: true, status: true, lastChargeAt: true, purchasedAt: true, currentPeriodEnd: true, planPeriodicity: true, hotmartSubscriberCode: true },
    });
    for (const t of ts) {
      console.log(`\n  ■ ${t.name} (${t.status}) id=${t.id}`);
      console.log(`    lastChargeAt=${t.lastChargeAt?.toISOString()?.slice(0,10) ?? 'null'} · purchasedAt=${t.purchasedAt?.toISOString()?.slice(0,10) ?? 'null'} · periodEnd=${t.currentPeriodEnd?.toISOString()?.slice(0,10) ?? 'null'} · plan=${t.planPeriodicity ?? '-'} · hotmartSub=${t.hotmartSubscriberCode ?? '-'}`);
      // Comisiones de este tenant (por fecha)
      const comms = await prisma.commission.findMany({
        where: { referralUse: { tenantId: t.id } },
        select: { id: true, amount: true, status: true, businessDate: true, availableAt: true, createdAt: true, recipientCode: { select: { code: true, ownerName: true } } },
        orderBy: { createdAt: 'asc' },
      });
      console.log(`    comisiones (${comms.length}):`);
      comms.forEach((c) => console.log(`      $${Number(c.amount)} [${c.status}] bizDate=${c.businessDate?.toISOString()?.slice(0,10) ?? '-'} avail=${c.availableAt?.toISOString()?.slice(0,10) ?? '-'} → ${c.recipientCode?.code ?? '?'} (${c.recipientCode?.ownerName ?? '?'})`));
    }
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
