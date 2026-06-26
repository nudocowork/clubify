// Verifica a qué marca quedó asociado un negocio (tenant) — para confirmar el
// fix del P0: que un signup de Sellea quede con whiteLabelId de Sellea (no null).
// Pasá el SLUG o el EMAIL del negocio de prueba como argumento.
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/check-tenant-brand.cjs <slug-o-email>
const { PrismaClient } = require('@prisma/client');

(async () => {
  const q = (process.argv[2] || '').trim().toLowerCase();
  if (!q) {
    console.error('Pasá el slug o email. Ej: node check-tenant-brand.cjs mi-negocio-prueba');
    process.exit(1);
  }
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const t = await prisma.tenant.findFirst({
    where: { OR: [{ slug: q }, { email: q }] },
    select: {
      id: true, slug: true, brandName: true, email: true, status: true,
      planPeriodicity: true, whiteLabelId: true,
      whiteLabel: { select: { slug: true, name: true } },
      currentPeriodEnd: true,
    },
  });
  if (!t) {
    console.log(`❌ No encontré ningún negocio con slug/email = "${q}".`);
    await prisma.$disconnect();
    return;
  }

  const brand = t.whiteLabel?.slug ?? (t.whiteLabelId ? '(id sin marca?)' : 'NULL → Clubify/legacy');
  const okBrand = t.whiteLabel?.slug === 'sellea';
  const okActive = t.status === 'ACTIVE';

  console.log('─────────────────────────────');
  console.log(' Negocio :', t.brandName, '·', t.slug);
  console.log(' Email   :', t.email);
  console.log(' Estado  :', t.status, okActive ? '✅' : '(no ACTIVE)');
  console.log(' Marca   :', brand, okBrand ? '✅ Sellea' : (brand.includes('NULL') ? '❌ quedó SIN marca (bug)' : ''));
  console.log(' Periodo :', t.planPeriodicity ?? '—', '· próximo cobro:', t.currentPeriodEnd ?? '—');
  console.log('─────────────────────────────');
  console.log(okBrand && okActive
    ? '✅ TODO OK: el negocio quedó ACTIVO y bajo Sellea (P0 resuelto end-to-end).'
    : '⚠️ Revisar: marca=' + brand + ' estado=' + t.status);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
