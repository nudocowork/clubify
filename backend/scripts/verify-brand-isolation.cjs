// Verificación de AISLAMIENTO POR MARCA BLANCA a nivel de QUERY. Ejecuta las
// mismas cláusulas WHERE que usa el backend (brandTenantWhere / brandWhiteLabelWhere)
// para cada marca y comprueba que NO se solapen datos entre marcas. Read-only.
//   railway run --service Postgres-Nq8w node scripts/verify-brand-isolation.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL — corré con `railway run --service Postgres-Nq8w`');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const brands = await prisma.whiteLabel.findMany({
    select: { id: true, slug: true },
    orderBy: { slug: 'asc' },
  });
  const clubify = brands.find((b) => b.slug === 'clubify');
  const clubifyId = clubify?.id ?? null;

  // Réplica EXACTA de brandWhiteLabelWhere (brand-scope.util.ts): Clubify ve
  // sus registros + legacy null; otra marca, estricto a su id.
  function brandWhere(sessionWlId) {
    const wlId = sessionWlId ?? clubifyId;
    if (!wlId) return {};
    if (wlId === clubifyId) {
      return { OR: [{ whiteLabelId: clubifyId }, { whiteLabelId: null }] };
    }
    return { whiteLabelId: wlId };
  }

  let failures = 0;
  const tenantSets = {};

  for (const b of brands) {
    const brand = brandWhere(b.id);
    const tenantRel = brand; // tenant.whiteLabelId
    // 1) NEGOCIOS (tenants.list / metrics → brandTenantWhere sobre Tenant)
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null, ...brand },
      select: { id: true, brandName: true, whiteLabelId: true },
    });
    tenantSets[b.slug] = new Set(tenants.map((t) => t.id));
    const badTenant = tenants.filter(
      (t) => t.whiteLabelId !== b.id && !(b.id === clubifyId && t.whiteLabelId === null),
    );

    // 2) AFILIADOS (business-map.listAffiliates → ReferralCode.whiteLabelId)
    const codes = await prisma.referralCode.findMany({
      where: { isActive: true, ...brand },
      select: { id: true, whiteLabelId: true },
    });
    const badCode = codes.filter(
      (c) => c.whiteLabelId !== b.id && !(b.id === clubifyId && c.whiteLabelId === null),
    );

    // 3) CAMPAÑAS (campaigns.list → ownerCode.whiteLabelId)
    const camps = await prisma.campaign.findMany({
      where: { ownerCode: brand },
      select: { id: true, ownerCode: { select: { whiteLabelId: true } } },
    });
    const badCamp = camps.filter(
      (c) => c.ownerCode.whiteLabelId !== b.id && !(b.id === clubifyId && c.ownerCode.whiteLabelId === null),
    );

    // 4) COMISIONES (commissions-audit → referralUse.tenant brand)
    const comms = await prisma.commission.count({
      where: { referralUse: { tenant: tenantRel } },
    });

    console.log(`\n## ${b.slug} (${b.id})`);
    console.log(`   negocios=${tenants.length}  afiliados=${codes.length}  campañas=${camps.length}  comisiones=${comms}`);
    if (badTenant.length) { failures++; console.log(`   ❌ ${badTenant.length} negocios de OTRA marca`); }
    if (badCode.length) { failures++; console.log(`   ❌ ${badCode.length} afiliados de OTRA marca`); }
    if (badCamp.length) { failures++; console.log(`   ❌ ${badCamp.length} campañas de OTRA marca`); }
    if (!badTenant.length && !badCode.length && !badCamp.length) {
      console.log('   ✓ todo pertenece a esta marca');
    }
  }

  // 5) Cross-check: ningún tenant aparece en dos marcas a la vez.
  console.log('\n========== CRUCE ENTRE MARCAS ==========');
  const slugs = Object.keys(tenantSets);
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      const a = tenantSets[slugs[i]];
      const c = tenantSets[slugs[j]];
      const overlap = [...a].filter((id) => c.has(id));
      // Clubify incluye legacy null; las demás son disjuntas. Clubify vs otra
      // NO debe solapar porque otra marca tiene su propio whiteLabelId.
      if (overlap.length) {
        failures++;
        console.log(`❌ ${slugs[i]} ∩ ${slugs[j]} = ${overlap.length} tenants COMPARTIDOS`);
      } else {
        console.log(`✓ ${slugs[i]} ∩ ${slugs[j]} = 0 (disjuntos)`);
      }
    }
  }

  console.log('\n========== RESULTADO ==========');
  console.log(failures === 0 ? '✅ AISLAMIENTO TOTAL: 0 fugas entre marcas.' : `❌ ${failures} fuga(s) detectada(s).`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(1); });
