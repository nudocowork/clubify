// Backfill: asigna los tenants legacy con whiteLabelId NULL a la marca
// 'clubify'. null históricamente = Clubify (antes de marcas blancas). Deja la
// data consistente para el aislamiento por marca (el SUPER_ADMIN de Clubify se
// scopea por id-IN vía middleware y sino no veía los legacy null). Idempotente.
//
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/backfill-null-tenants-to-clubify.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const clubify = await prisma.whiteLabel.findFirst({ where: { slug: 'clubify' }, select: { id: true } });
  if (!clubify) { console.error('No existe la marca clubify'); process.exit(1); }

  const before = await prisma.tenant.count({ where: { whiteLabelId: null } });
  console.log(`tenants con whiteLabelId null: ${before}`);
  if (before === 0) { console.log('Nada para backfillear.'); await prisma.$disconnect(); return; }

  const r = await prisma.tenant.updateMany({
    where: { whiteLabelId: null },
    data: { whiteLabelId: clubify.id },
  });
  console.log(`✅ ${r.count} tenants reasignados a clubify (${clubify.id}).`);

  const after = await prisma.tenant.count({ where: { whiteLabelId: null } });
  console.log(`tenants null restantes: ${after} (debe ser 0)`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
