// SOLO LECTURA. ¿La Burguesía y El Regio están en un grupo, y quién le movió
// la fecha de cobro al 16-dic y le borró el fallo del 16-nov? (2026-11-16)
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const d = (x) => (x ? new Date(x).toISOString().slice(0, 16) : '—');
(async () => {
  const ts = await p.tenant.findMany({
    where: { OR: [{ name: { contains: 'burgues', mode: 'insensitive' } }, { name: { contains: 'regio', mode: 'insensitive' } }] },
    select: { id: true, name: true, businessGroupId: true, hotmartSubscriberCode: true, currentPeriodEnd: true, failedPaymentCount: true, lastChargeAt: true, planPeriodicity: true },
  });
  for (const t of ts) console.log(t.name, '| grupo', t.businessGroupId, '| sub', t.hotmartSubscriberCode, '| fin', d(t.currentPeriodEnd), '| fallos', t.failedPaymentCount, '| último cobro', d(t.lastChargeAt), t.planPeriodicity);
  const gids = [...new Set(ts.map((t) => t.businessGroupId).filter(Boolean))];
  for (const gid of gids) {
    const g = await p.businessGroup.findUnique({ where: { id: gid } });
    console.log('\nGRUPO', JSON.stringify(g, (k, v) => (typeof v === 'string' && v.length > 80 ? v.slice(0, 80) : v)));
    const miembros = await p.tenant.findMany({ where: { businessGroupId: gid }, select: { name: true, hotmartSubscriberCode: true, currentPeriodEnd: true, status: true } });
    for (const m of miembros) console.log('  miembro', m.name, m.status, m.hotmartSubscriberCode, d(m.currentPeriodEnd));
  }
  console.log('\nEventos Hotmart desde el 25-oct de estos negocios y de su grupo:');
  const ev = await p.hotmartWebhookEvent.findMany({
    where: { processedAt: { gte: new Date('2026-10-25') }, OR: [{ tenantId: { in: ts.map((t) => t.id) } }] },
    orderBy: { processedAt: 'asc' }, select: { tenantId: true, eventType: true, processedAt: true, payload: true },
  });
  const nom = new Map(ts.map((t) => [t.id, t.name]));
  for (const e of ev) {
    const pu = e.payload?.data?.purchase ?? {};
    console.log(' ', d(e.processedAt), nom.get(e.tenantId), e.eventType, pu.transaction ?? '', 'sub', e.payload?.data?.subscription?.subscriber?.code ?? '', 'next', pu.date_next_charge ? d(pu.date_next_charge) : '');
  }
  console.log('\nAuditoría de ciclo (cualquier negocio de la lista) desde el 25-oct:');
  const al = await p.auditLog.findMany({ where: { tenantId: { in: ts.map((t) => t.id) }, createdAt: { gte: new Date('2026-10-25') }, NOT: { action: 'auth.login' } }, orderBy: { createdAt: 'asc' } });
  for (const a of al) console.log(' ', d(a.createdAt), nom.get(a.tenantId), a.action, a.actorId ?? '', JSON.stringify(a.metadata).slice(0, 200));
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; }).finally(() => p.$disconnect());
