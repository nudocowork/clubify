/**
 * Solo lectura. Por qué el aviso de comisión de Motilart salió el 16-nov y no
 * cuando entró el pago por fuera (7-nov): cómo se registró el pago, cuándo
 * nacieron las comisiones y cuándo se avisaron.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const T = 'e08bfc71-d854-4d3c-bb02-accf10a22c17';
(async () => {
  const pagos = await p.manualPayment.findMany({ where: { tenantId: T }, orderBy: { createdAt: 'asc' } });
  console.log('MANUAL PAYMENTS');
  for (const m of pagos) console.log(' ', m.id, 'creado', m.createdAt.toISOString(), 'pagado', m.paidAt.toISOString(), m.method, m.amount && Number(m.amount), 'actor', m.actorId, m.note);
  const aud = await p.auditLog.findMany({ where: { tenantId: T, createdAt: { gte: new Date('2026-11-01') } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, action: true, actorId: true, resource: true } });
  console.log('AUDIT desde 1-nov');
  for (const a of aud) console.log(' ', a.createdAt.toISOString(), a.action, a.actorId, a.resource);
  let pend = [];
  try {
    pend = await p.pagoPorAprobar.findMany({ where: { tenantId: T } });
  } catch (e) { console.log('(sin modelo pagoPorAprobar:', e.message.split('\n')[0], ')'); }
  console.log('PAGOS POR APROBAR', pend.length);
  for (const x of pend) console.log(' ', JSON.stringify(x));
  const com = await p.commission.findMany({ where: { referralUse: { tenantId: T } }, orderBy: { createdAt: 'asc' }, select: { id: true, createdAt: true, amount: true, businessDate: true, availableAt: true, status: true, externalTxId: true } });
  console.log('COMISIONES');
  for (const c of com) console.log(' ', c.id, 'creada', c.createdAt.toISOString(), Number(c.amount), 'negocio', c.businessDate && c.businessDate.toISOString(), c.status, c.externalTxId);
  const al = await p.affiliateSaleAlert.findMany({ where: { commissionId: { in: com.map((c) => c.id) } } }).catch((e) => { console.log('alert err', e.message.split('\n')[0]); return []; });
  console.log('AVISOS');
  for (const a of al) console.log(' ', JSON.stringify(a));
  const uses = await p.referralUse.findMany({ where: { tenantId: T }, select: { id: true, status: true, convertedAt: true, referralCode: { select: { role: true, ownerName: true } } } });
  console.log('USOS'); for (const u of uses) console.log(' ', JSON.stringify(u));
  // ¿Cuántos pagos por fuera de los últimos 60 días quedaron sin comisión?
  const recientes = await p.manualPayment.findMany({ where: { createdAt: { gte: new Date(Date.now() - 60 * 864e5) } }, select: { tenantId: true, paidAt: true, createdAt: true, actorId: true } }); const nombres = Object.fromEntries((await p.tenant.findMany({ where: { id: { in: [...new Set(recientes.map((r) => r.tenantId))] } }, select: { id: true, brandName: true } })).map((t) => [t.id, t.brandName]));
  console.log('PAGOS MANUALES 60 d SIN COMISIÓN (con afiliado)');
  for (const m of recientes) {
    const u = await p.referralUse.count({ where: { tenantId: m.tenantId, referralCode: { role: { in: ['INFLUENCER', 'AMBASSADOR', 'VENDOR'] } } } });
    if (!u) continue;
    const c = await p.commission.findMany({ where: { referralUse: { tenantId: m.tenantId }, amount: { gt: 0 }, createdAt: { gte: new Date(m.createdAt.getTime() - 864e5) } }, orderBy: { createdAt: 'asc' }, take: 1, select: { createdAt: true } });
    const demora = c[0] ? ((c[0].createdAt - m.createdAt) / 3600e3).toFixed(1) + ' h' : 'NUNCA';
    console.log(' ', nombres[m.tenantId], 'pago reg', m.createdAt.toISOString().slice(0, 16), 'actor', m.actorId ? 'panel' : 'SCRIPT', '→ comisión', demora);
  }
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => p.$disconnect());
