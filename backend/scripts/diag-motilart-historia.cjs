// SOLO LECTURA. Historia de Motilart desde sept: eventos Hotmart y AuditLog.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const d = (x) => (x ? new Date(x).toISOString().slice(0, 16).replace('T', ' ') : '—');
const TID = 'e08bfc71-d854-4d3c-bb02-accf10a22c17';
(async () => {
  const t = await p.tenant.findUnique({ where: { id: TID }, select: { planPeriodicity: true, hotmartSubscriberCode: true, failedPaymentCount: true, estadoComercial: true, purchasedAt: true } }).catch(async () => p.tenant.findUnique({ where: { id: TID } }));
  console.log('TENANT', JSON.stringify(t));
  const ev = await p.hotmartWebhookEvent.findMany({ where: { tenantId: TID, processedAt: { gte: new Date('2026-09-15') } }, orderBy: { processedAt: 'asc' } });
  console.log('HOTMART', ev.length);
  for (const e of ev) {
    const pu = e.payload?.data?.purchase ?? {};
    console.log(`  ${d(e.processedAt)} ${e.eventType} tx=${pu.transaction ?? '—'} status=${pu.status ?? '—'} next=${pu.date_next_charge ? d(Number(pu.date_next_charge)) : '—'} recurr=${pu.recurrence_number ?? '—'} subStatus=${e.payload?.data?.subscription?.status ?? '—'}`);
  }
  const logs = await p.auditLog.findMany({ where: { tenantId: TID, createdAt: { gte: new Date('2026-09-15') } }, orderBy: { createdAt: 'asc' } });
  console.log('AUDIT', logs.length);
  for (const l of logs) console.log(`  ${d(l.createdAt)} ${l.action} ${l.resource} actor=${l.actorId ?? '—'} ${JSON.stringify(l.metadata).slice(0, 400)}`);
  const otros = await p.auditLog.findMany({ where: { createdAt: { gte: new Date('2026-11-16T15:00:00Z') }, tenantId: null }, orderBy: { createdAt: 'asc' } });
  console.log('AUDIT SIN NEGOCIO HOY >=15:00Z', otros.length);
  for (const l of otros) console.log(`  ${d(l.createdAt)} ${l.action} ${l.resource} ${JSON.stringify(l.metadata).slice(0, 300)}`);
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; }).finally(() => p.$disconnect());
