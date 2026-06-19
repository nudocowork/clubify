// #6 aislamiento por marca: hace que CLUBIFY sea una marca scopeada como las
// demás (hoy sus admins tienen whiteLabelId null = "ven todo"). Asigna a la
// marca 'clubify':
//   - los User SUPER_ADMIN con whiteLabelId null (admins de Clubify)
//   - los Tenant con whiteLabelId null (negocios sin marca = legacy/creados
//     antes del fix). Asume que son de Clubify (la marca por defecto); los
//     pocos que sean de Sellea se reasignan luego desde el Master Admin.
//
// NO toca: PLATFORM_OWNER (Fidelia, ve todo vía /superadmin), ni users/tenants
// que ya tienen whiteLabelId (Sellea u otras).
//
// DRY-RUN por default. Aplicar: APPLY=1 railway run --service Postgres-Nq8w node /ABS/PATH/scope-clubify-whitelabel.cjs
const { PrismaClient } = require('@prisma/client');
const APPLY = process.env.APPLY === '1';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const clubify = await prisma.whiteLabel.findUnique({ where: { slug: 'clubify' } });
  if (!clubify) { console.error("No existe la marca 'clubify'"); process.exit(1); }
  console.log(`MODO: ${APPLY ? 'APPLY (escribe)' : 'DRY-RUN'}  ·  clubify id=${clubify.id}\n`);

  const adminsNull = await prisma.user.count({
    where: { role: 'SUPER_ADMIN', whiteLabelId: null },
  });
  const tenantsNull = await prisma.tenant.count({ where: { whiteLabelId: null } });

  console.log(`SUPER_ADMIN con whiteLabelId null → clubify: ${adminsNull}`);
  console.log(`Tenants con whiteLabelId null → clubify: ${tenantsNull}`);

  // Muestra los tenants null para que el user identifique los que en realidad
  // son de Sellea (a reasignar luego).
  const sample = await prisma.tenant.findMany({
    where: { whiteLabelId: null },
    select: { id: true, brandName: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  console.log('\nTenants null (más recientes — revisá si alguno es de Sellea):');
  for (const t of sample) {
    console.log(`  ${t.createdAt.toISOString().slice(0, 10)}  ${t.brandName}  (${t.id})`);
  }

  if (APPLY) {
    const a = await prisma.user.updateMany({
      where: { role: 'SUPER_ADMIN', whiteLabelId: null },
      data: { whiteLabelId: clubify.id },
    });
    const t = await prisma.tenant.updateMany({
      where: { whiteLabelId: null },
      data: { whiteLabelId: clubify.id },
    });
    console.log(`\n✅ Aplicado: ${a.count} admins + ${t.count} tenants → clubify.`);
    console.log('⚠️ Los admins deben volver a iniciar sesión para refrescar el JWT.');
    console.log('⚠️ Reasigná a Sellea los negocios que correspondan desde Master Admin → Marcas.');
  } else {
    console.log('\n(DRY-RUN — corré con APPLY=1 para aplicar)');
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
