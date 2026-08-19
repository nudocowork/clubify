// READ-ONLY: extrae el `src`/tracking REAL del/los HotmartWebhookEvent de monet.
const { PrismaClient } = require('@prisma/client');
const TENANT = '4bb55d47-23ea-47d4-8744-5fcdc6bffb14';
const SUB = '6MWN78PN';
const EMAIL = 'monet.guate@hotmail.com';
const track = (rp) => JSON.stringify(rp?.data?.purchase?.tracking || {});
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });

  const wl = await p.whiteLabel.findUnique({ where: { id: 'dfd3cdff-7836-4aee-96a4-d7fa2b2907be' }, select: { name: true, slug: true } });
  console.log('WhiteLabel de monet:', JSON.stringify(wl));

  const byTenant = await p.hotmartWebhookEvent.findMany({ where: { tenantId: TENANT }, orderBy: { processedAt: 'asc' }, select: { eventType: true, processedAt: true, payload: true } });
  console.log(`\n════ HotmartWebhookEvent por tenantId=monet: ${byTenant.length} ════`);
  for (const e of byTenant) {
    const b = e.payload?.data?.buyer || {};
    console.log(`  ${e.processedAt.toISOString()} ${e.eventType}`);
    console.log(`    buyer=${b.name}/${b.email}  tracking=${track(e.payload)}`);
    console.log(`    src candidates: source=${e.payload?.data?.purchase?.tracking?.source} sck=${e.payload?.data?.purchase?.tracking?.sck} external_code=${e.payload?.data?.purchase?.tracking?.external_code}`);
  }

  // Búsqueda amplia por subscriber/email/nombre en payloads recientes.
  console.log('\n════ Búsqueda amplia (payloads recientes con 6MWN78PN / email / monet) ════');
  const recent = await p.hotmartWebhookEvent.findMany({ orderBy: { processedAt: 'desc' }, take: 60, select: { eventType: true, processedAt: true, tenantId: true, payload: true } });
  const hits = recent.filter((e) => { const s = JSON.stringify(e.payload).toLowerCase(); return s.includes(SUB.toLowerCase()) || s.includes(EMAIL.toLowerCase()) || s.includes('monet'); });
  if (!hits.length) console.log('  (ninguno)');
  for (const e of hits) {
    const b = e.payload?.data?.buyer || {};
    console.log(`  ${e.processedAt.toISOString()} ${e.eventType} tenant=${e.tenantId} buyer=${b.name}/${b.email} tracking=${track(e.payload)}`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
