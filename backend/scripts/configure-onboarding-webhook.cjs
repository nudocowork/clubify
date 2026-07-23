// Fase D — configura el webhook saliente business.activated en prod.
// Escribe las 3 Settings (url/secret/enabled) que lee OnboardingWebhookService.
// Uso:
//   node scripts/configure-onboarding-webhook.cjs            # dry-run: genera secret + muestra plan
//   APPLY=1 node scripts/configure-onboarding-webhook.cjs    # escribe las Settings
//   APPLY=1 TEST=1 node ...                                  # + manda un webhook.test firmado y reporta HTTP
//   WEBHOOK_SECRET=xxx APPLY=1 node ...                      # usa un secret dado en vez de generar
// Ejecutar contra prod con: railway run --service Postgres-Nq8w node scripts/configure-onboarding-webhook.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const URL_DEFAULT = 'https://onboarding.soyclubify.lat/api/integrations/clubify-activated';
const K = {
  url: 'onboarding.webhook.url',
  secret: 'onboarding.webhook.secret',
  enabled: 'onboarding.webhook.enabled',
};

(async () => {
  const p = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
  });
  const url = (process.env.WEBHOOK_URL || URL_DEFAULT).trim();
  const apply = process.env.APPLY === '1';
  const test = process.env.TEST === '1';

  // Reusar el secret existente si ya hay uno, salvo que se fuerce uno nuevo.
  const existing = await p.setting.findMany({
    where: { key: { in: [K.url, K.secret, K.enabled] } },
    select: { key: true, value: true },
  });
  const cur = Object.fromEntries(existing.map((r) => [r.key, r.value]));
  const secret =
    process.env.WEBHOOK_SECRET ||
    cur[K.secret] ||
    crypto.randomBytes(32).toString('hex');
  const reused = !!(process.env.WEBHOOK_SECRET || cur[K.secret]) ? '(reusado/dado)' : '(generado NUEVO)';

  console.log('=== Fase D — configuración webhook ===');
  console.log('URL      :', url);
  console.log('ENABLED  : 1');
  console.log('SECRET   :', secret, reused);
  console.log('APPLY    :', apply ? 'SÍ (escribe)' : 'NO (dry-run)');
  console.log('');

  if (apply) {
    const upsert = (key, value) =>
      p.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    await p.$transaction([
      upsert(K.url, url),
      upsert(K.secret, secret),
      upsert(K.enabled, '1'),
    ]);
    const after = await p.setting.findMany({
      where: { key: { in: [K.url, K.secret, K.enabled] } },
      select: { key: true, value: true },
    });
    const m = Object.fromEntries(after.map((r) => [r.key, r.value]));
    console.log('✅ Escrito. Verificación:');
    console.log('   url     =', m[K.url]);
    console.log('   enabled =', m[K.enabled]);
    console.log('   secret  = ****' + (m[K.secret] || '').slice(-4), '(len', (m[K.secret] || '').length + ')');
  }

  if (test) {
    const payload = {
      event: 'webhook.test',
      message: 'Ping de Clubify (Onboarding Sync Fase D)',
      sent_at: new Date().toISOString(),
    };
    const raw = JSON.stringify(payload);
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Clubify-Event': 'webhook.test',
          'X-Clubify-Signature': sig,
        },
        body: raw,
        signal: ctrl.signal,
      });
      console.log(`\n🔔 Test ping → HTTP ${res.status} ${res.ok ? '(OK, endpoint responde)' : '(≠2xx)'}`);
    } catch (e) {
      console.log(`\n🔔 Test ping → error de red: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
