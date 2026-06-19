// #6 cleanup PRECISO de negocios sin marca (whiteLabelId null), según lo que
// confirmó el dueño:
//   SELLEA: Prueba-Sellea, Negocio virtual
//   CLUBIFY: todos los demás null + los SUPER_ADMIN null
//
// DRY-RUN por default. Aplicar: APPLY=1 railway run --service Postgres-Nq8w node /ABS/PATH/assign-orphan-tenants-brands.cjs
const { PrismaClient } = require('@prisma/client');
const APPLY = process.env.APPLY === '1';

// IDs confirmados por el dueño que van a SELLEA.
const SELLEA_TENANT_IDS = [
  '00500761-3d47-40e0-a3c9-c07f039ecce5', // Prueba-Sellea
  'f8a0f380-f511-4306-b39f-7e571c7882f2', // Negocio virtual
];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const clubify = await prisma.whiteLabel.findUnique({ where: { slug: 'clubify' } });
  const sellea = await prisma.whiteLabel.findUnique({ where: { slug: 'sellea' } });
  if (!clubify || !sellea) { console.error('Falta marca clubify o sellea'); process.exit(1); }
  console.log(`MODO: ${APPLY ? 'APPLY' : 'DRY-RUN'}  ·  clubify=${clubify.id}  sellea=${sellea.id}\n`);

  // 1) Los 2 negocios de Sellea.
  const selleaTenants = await prisma.tenant.findMany({
    where: { id: { in: SELLEA_TENANT_IDS } },
    select: { id: true, brandName: true, whiteLabelId: true },
  });
  console.log('→ SELLEA:');
  for (const t of selleaTenants) console.log(`   ${t.brandName} (${t.id}) actual=${t.whiteLabelId ?? 'null'}`);

  // 2) Resto de tenants null → clubify.
  const clubifyTenants = await prisma.tenant.findMany({
    where: { whiteLabelId: null, id: { notIn: SELLEA_TENANT_IDS } },
    select: { id: true, brandName: true },
  });
  console.log('\n→ CLUBIFY (resto null):');
  for (const t of clubifyTenants) console.log(`   ${t.brandName} (${t.id})`);

  // 3) SUPER_ADMIN null → clubify.
  const admins = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN', whiteLabelId: null },
    select: { id: true, email: true },
  });
  console.log('\n→ CLUBIFY (SUPER_ADMIN null):');
  for (const u of admins) console.log(`   ${u.email} (${u.id})`);

  if (APPLY) {
    const s = await prisma.tenant.updateMany({
      where: { id: { in: SELLEA_TENANT_IDS } },
      data: { whiteLabelId: sellea.id },
    });
    const c = await prisma.tenant.updateMany({
      where: { whiteLabelId: null, id: { notIn: SELLEA_TENANT_IDS } },
      data: { whiteLabelId: clubify.id },
    });
    const a = await prisma.user.updateMany({
      where: { role: 'SUPER_ADMIN', whiteLabelId: null },
      data: { whiteLabelId: clubify.id },
    });
    console.log(`\n✅ Aplicado: ${s.count} tenants→Sellea · ${c.count} tenants→Clubify · ${a.count} admins→Clubify`);
    console.log('⚠️ Los admins deben volver a iniciar sesión para refrescar el JWT.');
  } else {
    console.log('\n(DRY-RUN — corré con APPLY=1 para aplicar)');
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
