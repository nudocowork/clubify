// Diagnóstico de AISLAMIENTO POR MARCA BLANCA a nivel de ADMINS.
// Verifica que cada SUPER_ADMIN tenga su User.whiteLabelId correcto. El bug
// reportado: el admin de Sellea ve negocios de Clubify porque su whiteLabelId
// es NULL → el panel /admin hace default a Clubify. Read-only.
//   railway run --service Postgres-Nq8w node scripts/diagnose-brand-admin-isolation.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL — corré con `railway run --service Postgres-Nq8w`');
    process.exit(1);
  }
  console.log('Connecting to:', url.replace(/:\/\/[^@]+@/, '://***:***@'));
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // 1) Marcas blancas existentes
  const brands = await prisma.whiteLabel.findMany({
    select: { id: true, slug: true, name: true, domain: true, appDomain: true },
    orderBy: { slug: 'asc' },
  });
  console.log('\n========== MARCAS BLANCAS ==========');
  for (const b of brands) {
    const tcount = await prisma.tenant.count({ where: { whiteLabelId: b.id } });
    console.log(`- ${b.slug.padEnd(12)} id=${b.id}  tenants=${tcount}  dom=${b.domain || b.appDomain || '-'}  "${b.name}"`);
  }
  const clubify = brands.find((b) => b.slug === 'clubify');

  // 2) Tenants sin marca (legacy null)
  const nullTenants = await prisma.tenant.count({ where: { whiteLabelId: null } });
  console.log(`\nTenants con whiteLabelId NULL (legacy): ${nullTenants}`);

  // 3) TODOS los SUPER_ADMIN / PLATFORM_OWNER y su marca
  const admins = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'PLATFORM_OWNER'] } },
    select: {
      id: true, email: true, fullName: true, role: true,
      whiteLabelId: true, tenantId: true, isActive: true,
      whiteLabel: { select: { slug: true } },
      tenant: { select: { slug: true, whiteLabelId: true, whiteLabel: { select: { slug: true } } } },
    },
    orderBy: [{ role: 'asc' }, { email: 'asc' }],
  });
  console.log('\n========== ADMINS (SUPER_ADMIN / PLATFORM_OWNER) ==========');
  console.log('role | email | whiteLabelId(slug) | via-tenant | active | ⚠');
  const suspects = [];
  for (const a of admins) {
    const wlSlug = a.whiteLabel?.slug || (a.whiteLabelId ? '??' : 'NULL');
    const tWl = a.tenant?.whiteLabel?.slug || '-';
    // Sospechoso: SUPER_ADMIN sin whiteLabelId propio que NO sea de Clubify.
    // Si su email sugiere otra marca o cuelga de un tenant de otra marca → leak.
    const looksNonClubify =
      a.role === 'SUPER_ADMIN' &&
      !a.whiteLabelId &&
      (tWl !== '-' && tWl !== 'clubify' ||
        /sellea|fideliso/i.test(a.email + ' ' + (a.fullName || '')));
    const flag = looksNonClubify ? '  <<< LEAK: null → default Clubify' : '';
    if (looksNonClubify) suspects.push(a);
    console.log(
      `${a.role.padEnd(14)} ${a.email.padEnd(34)} ${String(wlSlug).padEnd(12)} via:${tWl.padEnd(10)} ${a.isActive ? 'on ' : 'OFF'}${flag}`,
    );
  }

  console.log('\n========== VEREDICTO ==========');
  if (suspects.length) {
    console.log(`⚠ ${suspects.length} admin(s) de marca NO-Clubify con whiteLabelId NULL → ven datos de Clubify:`);
    for (const s of suspects) console.log(`   - ${s.email} (id=${s.id})`);
    console.log('\nFix: setear User.whiteLabelId a la marca correcta de cada uno.');
  } else {
    console.log('✓ No se detectaron admins NO-Clubify con whiteLabelId null por heurística.');
    console.log('  (Revisá manualmente la lista de arriba: cualquier admin de Sellea/otra');
    console.log('   marca DEBE tener su whiteLabelId(slug) = su marca, NO NULL ni clubify.)');
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
