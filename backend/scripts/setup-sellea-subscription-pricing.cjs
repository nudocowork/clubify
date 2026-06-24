// Configura la suscripción/precios de Sellea (idempotente):
//  - subscriptionFeatureKeys = las 12 features MENOS las 3 que Sellea no incluye
//    (dominio propio + analítica, email transaccional, automatizaciones WhatsApp).
//  - installationFeeUsd = 250, installationPromoUsd = 100 (página de precios).
// No toca branding ni planes. Correr DESPUÉS de la migración + deploy.
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/setup-sellea-subscription-pricing.cjs
const { PrismaClient } = require('@prisma/client');

const ALL = [
  'featUnlimitedOrders',
  'featUnlimitedWalletCards',
  'featAppleGoogleWallet',
  'featMultiLocationStaff',
  'featCustomDomainAnalytics', // ← Sellea NO incluye
  'featWhatsappAutomations', // ← Sellea NO incluye
  'featEventMessages',
  'featAdvancedSegmentation',
  'featMessageTemplates',
  'featScannerPwa',
  'featTransactionalEmail', // ← Sellea NO incluye
  'featChatSupport',
];
const REMOVE = new Set([
  'featCustomDomainAnalytics',
  'featTransactionalEmail',
  'featWhatsappAutomations',
]);

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const wl = await prisma.whiteLabel.findFirst({ where: { slug: 'sellea' } });
  if (!wl) {
    console.error('No existe la marca sellea — nada que hacer.');
    process.exit(1);
  }

  const keys = ALL.filter((k) => !REMOVE.has(k));
  await prisma.whiteLabel.update({
    where: { id: wl.id },
    data: {
      subscriptionFeatureKeys: keys,
      installationFeeUsd: 250,
      installationPromoUsd: 100,
    },
  });

  console.log(`✅ Sellea actualizada:`);
  console.log(`   subscriptionFeatureKeys (${keys.length}): ${keys.join(', ')}`);
  console.log(`   installationFeeUsd: 250 · installationPromoUsd: 100`);

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
