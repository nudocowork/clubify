// Configura la marca Fideliso (espejo de configure-sellea.cjs). Idempotente.
// Paleta derivada del logo: azul #2563EB primario + acento naranja del logo.
// Correr DESPUÉS de tener la marca con slug "fideliso" y su logo/favicon subidos.
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/configure-fideliso.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL — usa: railway run --service Postgres-Nq8w node ...');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const fideliso = await prisma.whiteLabel.findFirst({ where: { slug: 'fideliso' } });
  if (!fideliso) {
    console.error('No existe la marca con slug "fideliso".');
    process.exit(1);
  }

  console.log('ANTES:', {
    name: fideliso.name,
    domain: fideliso.domain,
    primaryColor: fideliso.primaryColor,
    secondaryColor: fideliso.secondaryColor,
    backgroundColor: fideliso.backgroundColor,
    supportColor: fideliso.supportColor,
    instagram: fideliso.instagram,
    contactEmail: fideliso.contactEmail,
    initial: fideliso.initial,
  });

  const updated = await prisma.whiteLabel.update({
    where: { id: fideliso.id },
    data: {
      name: 'Fideliso',
      domain: 'www.fideliso.com',
      appDomain: 'app.fideliso.com',
      primaryColor: '#2563EB',   // Azul Fideliso
      secondaryColor: '#0B1B3A', // Tinta (navy oscuro)
      backgroundColor: '#EEF4FF',// Fondo suave azulado
      supportColor: '#1D4ED8',   // Azul oscuro de apoyo
      instagram: '@fideliso',
      contactEmail: 'hola@fideliso.com',
      adminEmail: 'hola@fideliso.com',
      initial: 'F',
    },
  });
  console.log('✅ Fideliso configurada:', {
    name: updated.name,
    domain: updated.domain,
    appDomain: updated.appDomain,
    primaryColor: updated.primaryColor,
    secondaryColor: updated.secondaryColor,
    backgroundColor: updated.backgroundColor,
    supportColor: updated.supportColor,
    instagram: updated.instagram,
    contactEmail: updated.contactEmail,
    initial: updated.initial,
  });

  // Mismos 4 módulos que Sellea habilitados para Fideliso.
  for (const m of ['REFERRALS', 'ORDERS', 'GROW_BUSINESS_SMS', 'REVIEWS']) {
    await prisma.whiteLabelModule.upsert({
      where: { whiteLabelId_module: { whiteLabelId: fideliso.id, module: m } },
      update: { enabled: true },
      create: { whiteLabelId: fideliso.id, module: m, enabled: true },
    });
  }
  console.log('✅ Módulos de Fideliso habilitados (REFERRALS, ORDERS, GROW_BUSINESS_SMS, REVIEWS).');

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
