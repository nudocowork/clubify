// Diagnóstico READ-ONLY de módulos por marca blanca (WhiteLabelModule).
// Objetivo: ver si GROW_BUSINESS_SMS está habilitado (gatea la sección
// "Automatizaciones" en Master Admin → Marcas).
// Usage:
//   railway run --service Postgres-Nq8w node scripts/diagnose-brand-modules.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL — corré con `railway run --service Postgres-Nq8w`');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const wls = await prisma.whiteLabel.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      modules: { select: { module: true, enabled: true }, orderBy: { module: 'asc' } },
    },
    orderBy: { slug: 'asc' },
  });

  const ALL = ['REFERRALS', 'ORDERS', 'GROW_BUSINESS_SMS', 'REVIEWS', 'COMMUNITY'];
  for (const w of wls) {
    const byMod = new Map(w.modules.map((m) => [m.module, m.enabled]));
    const gb = byMod.has('GROW_BUSINESS_SMS')
      ? byMod.get('GROW_BUSINESS_SMS')
        ? 'ON'
        : 'OFF'
      : 'SIN FILA (default oculto)';
    console.log(`\n=== ${w.slug}  (${w.name})  [${w.status}]`);
    console.log(`    GROW_BUSINESS_SMS: ${gb}   → Automatizaciones ${gb === 'ON' ? 'SE VE ✅' : 'OCULTA ❌'}`);
    console.log(
      '    módulos:',
      ALL.map((m) => `${m}=${byMod.has(m) ? (byMod.get(m) ? 'ON' : 'OFF') : '—'}`).join('  '),
    );
  }

  await prisma.$disconnect();
})();
