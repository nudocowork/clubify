// Diagnóstico de COMISIONES de Urban Cafe: modo de reparto del tenant,
// comisiones generadas (3-way split) y la cadena influencer/vendedor.
// Read-only. Usage:
//   railway run --service Postgres-Nq8w node scripts/diagnose-urbancafe-commissions.cjs
const { PrismaClient } = require('@prisma/client');

const NEEDLE = process.env.NEEDLE || 'urban';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL — corré con `railway run --service Postgres-Nq8w`');
    process.exit(1);
  }
  console.log('Connecting to:', url.replace(/:\/\/[^@]+@/, '://***:***@'));
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const tenants = await prisma.tenant.findMany({
    where: {
      OR: [
        { brandName: { contains: NEEDLE, mode: 'insensitive' } },
        { slug: { contains: NEEDLE, mode: 'insensitive' } },
        { email: { contains: NEEDLE, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true, slug: true, brandName: true, email: true, status: true,
      hotmartSubscriberCode: true, subscriptionPriceUsd: true,
      planPeriodicity: true, commissionDistributionMode: true,
    },
  });

  console.log(`\n=== Tenants que matchean "${NEEDLE}" (${tenants.length}) ===`);
  for (const t of tenants) {
    console.log(`\n🏢 ${t.brandName}  (slug=${t.slug}  id=${t.id.slice(0, 8)})`);
    console.log(`   email=${t.email}  status=${t.status}`);
    console.log(`   hotmartSubscriberCode=${t.hotmartSubscriberCode ?? '—'}`);
    console.log(`   subscriptionPriceUsd=${t.subscriptionPriceUsd ?? '—'}  planPeriodicity=${t.planPeriodicity ?? '—'}`);
    console.log(`   👉 commissionDistributionMode=${t.commissionDistributionMode}`);

    const uses = await prisma.referralUse.findMany({
      where: { tenantId: t.id },
      include: {
        referralCode: { select: { code: true, ownerName: true, role: true, commissionPercent: true } },
        commissions: {
          include: {
            recipientCode: { select: { code: true, ownerName: true, role: true } },
            vendorCode: { select: { code: true, ownerName: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!uses.length) { console.log('   (sin ReferralUse — no referido)'); continue; }

    for (const u of uses) {
      console.log(`\n   📌 ReferralUse ${u.id.slice(0, 8)}  status=${u.status}`);
      console.log(`      código usado: ${u.referralCode.code} (${u.referralCode.ownerName}, ${u.referralCode.role}, ${u.referralCode.commissionPercent}%)`);
      if (!u.commissions.length) { console.log('      (sin comisiones)'); }
      else {
        console.log(`      Comisiones (${u.commissions.length}):`);
        for (const c of u.commissions) {
          const who = c.recipientCode ? `${c.recipientCode.ownerName} [${c.recipientCode.role}]` : '(derivado del use)';
          console.log(`        - ${who}  $${c.amount}  ${c.status}  mode=${c.distributionMode ?? 'legacy'}  base=${c.baseAmountUsd ?? '—'}  pct=${c.appliedPercent ?? '—'}  paidAt=${c.paidAt ? c.paidAt.toISOString().slice(0, 10) : '—'}`);
        }
      }
    }

    // --- Cadena de atribución: walk hacia arriba desde el code del use ---
    console.log(`\n   🔗 Cadena de atribución (% configurado HOY):`);
    const seen = new Set();
    let cur = uses[0]?.referralCode ? await prisma.referralCode.findUnique({
      where: { code: uses[0].referralCode.code },
    }) : null;
    const chain = [];
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push(cur);
      const parentId = cur.parentEmbajadorCodeId || cur.parentCodeId;
      cur = parentId ? await prisma.referralCode.findUnique({ where: { id: parentId } }) : null;
    }
    for (const c of chain) {
      console.log(`      • ${c.ownerName}  [${c.role}]  ${c.commissionPercent}%  (code=${c.code}, active=${c.isActive})`);
    }

    // Excepciones de comisión para este tenant
    const excs = await prisma.commissionException.findMany({
      where: { tenantId: t.id },
      include: { recipientCode: { select: { ownerName: true } } },
    });
    if (excs.length) {
      console.log(`   ⚙️  Excepciones de comisión (override el %):`);
      for (const e of excs) console.log(`      • ${e.recipientCode?.ownerName ?? e.recipientCodeId.slice(0,8)} → ${e.customPercent}% (active=${e.isActive})`);
    } else {
      console.log(`   ⚙️  Sin excepciones de comisión para este tenant.`);
    }

    // Simulación de lo que recalcTenantSplit produciría
    const base = Number(t.subscriptionPriceUsd) > 0
      ? Number(t.subscriptionPriceUsd)
      : ({ TRIMESTRAL: 150, SEMESTRAL: 278, ANUAL: 500 }[t.planPeriodicity] ?? 50);
    const r2 = (n) => Math.round(n * 100) / 100;
    const influencer = chain.find((c) => c.role === 'INFLUENCER');
    const embajador = chain.find((c) => c.role === 'AMBASSADOR');
    const vendor = chain.find((c) => c.role === 'VENDOR');
    const pct = (c) => {
      if (!c) return 0;
      const e = excs.find((x) => x.recipientCodeId === c.id && x.isActive);
      return e ? Number(e.customPercent) : Number(c.commissionPercent);
    };
    console.log(`\n   🧮 Simulación (base real=$${base}):`);
    for (const mode of ['DISCOUNT_FROM_INFLUENCER', 'ADDITIONAL_COMPANY_COMMISSION']) {
      const additional = mode === 'ADDITIONAL_COMPANY_COMMISSION';
      const infP = pct(influencer), embP = pct(embajador), venRaw = pct(vendor);
      const venP = embajador && !additional ? Math.min(venRaw, embP) : venRaw;
      const lines = [];
      if (influencer && infP > 0) lines.push(`influencer ${influencer.ownerName} ${infP}% = $${r2(base * infP / 100)}`);
      if (embajador) { const ep = additional ? embP : Math.max(0, embP - venP); if (ep > 0) lines.push(`embajador ${embajador.ownerName} ${ep}% = $${r2(base * ep / 100)}`); }
      if (vendor && venP > 0) lines.push(`vendedor ${vendor.ownerName} ${venP}% = $${r2(base * venP / 100)}`);
      console.log(`      [${additional ? 'ADICIONAL' : 'DESCUENTO'}] ${lines.join('  |  ') || '(nada)'}`);
    }
  }

  await prisma.$disconnect();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
