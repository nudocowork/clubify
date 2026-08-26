// Fase 3 SELLEALA: activa el registro público de afiliados/influencer PARA
// SELLEA (por marca, no global). Requiere el código de Fase 3 ya desplegado
// (config/register brand-aware por host + claves por slug). Idempotente.
//
// Claves (getPublicAffiliateRegistrationConfig con brandSlug='sellea'):
//   affiliate.publicRegistration.enabled.sellea        = 'true'
//   affiliate.publicRegistration.allowInfluencer.sellea= 'true'
//   affiliate.publicRegistration.allowAmbassador.sellea= 'true'
// Los % (influencer/ambassador) se dejan al DEFAULT (10 / 15); el founder los
// ajusta desde /admin/affiliate-registration (ya scopeado a su marca). NO se
// tocan las claves globales de Clubify.
//
// Uso: railway run --service Postgres-Nq8w node scripts/enable-sellea-affiliate-registration.cjs
const { PrismaClient } = require('@prisma/client');

const SLUG = 'sellea';
const SETTINGS = {
  [`affiliate.publicRegistration.enabled.${SLUG}`]: 'true',
  [`affiliate.publicRegistration.allowInfluencer.${SLUG}`]: 'true',
  [`affiliate.publicRegistration.allowAmbassador.${SLUG}`]: 'true',
};

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const wl = await prisma.whiteLabel.findFirst({ where: { slug: SLUG }, select: { id: true } });
  if (!wl) { console.error(`No existe la marca ${SLUG}`); process.exit(1); }

  for (const [key, value] of Object.entries(SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    console.log(`• ${key} = '${value}' ✓`);
  }

  // Verificación
  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: `affiliate.publicRegistration.` } },
    select: { key: true, value: true },
    orderBy: { key: 'asc' },
  });
  console.log('Estado registro público:', JSON.stringify(rows));
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
