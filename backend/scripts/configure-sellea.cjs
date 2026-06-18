// Configura la marca Sellea según su Manual de Identidad. Idempotente.
// Correr DESPUÉS de aplicar la migración de branding (campos logoUrl/colores).
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/configure-sellea.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const sellea = await prisma.whiteLabel.findFirst({ where: { slug: 'sellea' } });
  if (!sellea) {
    console.error('No existe la marca con slug "sellea".');
    process.exit(1);
  }

  const updated = await prisma.whiteLabel.update({
    where: { id: sellea.id },
    data: {
      name: 'Sellea',
      domain: 'www.selleala.com',
      primaryColor: '#FF4D3D', // Coral
      secondaryColor: '#1A1033', // Tinta
      backgroundColor: '#FFF6F0', // Crema
      supportColor: '#E63521', // Coral oscuro
      instagram: '@selleala',
      contactEmail: 'hola@selleala.com',
      adminEmail: 'hola@selleala.com',
      initial: 'S',
    },
  });
  console.log('✅ Sellea configurada:', {
    name: updated.name,
    domain: updated.domain,
    primaryColor: updated.primaryColor,
    secondaryColor: updated.secondaryColor,
    instagram: updated.instagram,
    contactEmail: updated.contactEmail,
  });

  // Asegura los 4 módulos (incluye REVIEWS) habilitados para Sellea.
  for (const m of ['REFERRALS', 'ORDERS', 'GROW_BUSINESS_SMS', 'REVIEWS']) {
    await prisma.whiteLabelModule.upsert({
      where: { whiteLabelId_module: { whiteLabelId: sellea.id, module: m } },
      update: { enabled: true },
      create: { whiteLabelId: sellea.id, module: m, enabled: true },
    });
  }
  console.log('✅ Módulos de Sellea habilitados (REFERRALS, ORDERS, GROW_BUSINESS_SMS, REVIEWS).');

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
