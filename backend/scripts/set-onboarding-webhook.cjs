// Configura el Webhook de activación del Onboarding Sync API (Fase D) escribiendo
// las 3 filas de Setting directamente en prod (equivalente a PUT /onboarding-webhook,
// que requiere JWT PLATFORM_OWNER).
//
//   onboarding.webhook.url      → endpoint del onboarding
//   onboarding.webhook.secret   → secreto compartido (HMAC-sha256)
//   onboarding.webhook.enabled  → '1'
//
// El secreto NO se hardcodea: se pasa por env para no dejarlo en el repo.
//   WEBHOOK_URL='https://...' WEBHOOK_SECRET='...' \
//     railway run --service Postgres-Nq8w node scripts/set-onboarding-webhook.cjs
const { PrismaClient } = require('@prisma/client');

const K = {
  url: 'onboarding.webhook.url',
  secret: 'onboarding.webhook.secret',
  enabled: 'onboarding.webhook.enabled',
};

(async () => {
  const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }

  const url = (process.env.WEBHOOK_URL || '').trim();
  const secret = process.env.WEBHOOK_SECRET || '';
  const enabled = process.env.WEBHOOK_ENABLED === '0' ? '0' : '1';
  if (!url) { console.error('Falta WEBHOOK_URL'); process.exit(1); }
  if (!secret) { console.error('Falta WEBHOOK_SECRET'); process.exit(1); }

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const up = (key, value) =>
    prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });

  await prisma.$transaction([
    up(K.url, url),
    up(K.secret, secret),
    up(K.enabled, enabled),
  ]);

  // Confirmación (sin exponer el secreto en claro).
  const rows = await prisma.setting.findMany({
    where: { key: { in: [K.url, K.secret, K.enabled] } },
    select: { key: true, value: true },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  console.log('✅ Webhook Onboarding configurado:');
  console.log('   url     :', map[K.url]);
  console.log('   enabled :', map[K.enabled] === '1');
  console.log('   secret  : ****' + (map[K.secret] ? map[K.secret].slice(-4) : '(vacío)'),
    `(len=${map[K.secret] ? map[K.secret].length : 0})`);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
