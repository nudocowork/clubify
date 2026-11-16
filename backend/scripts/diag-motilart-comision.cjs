// SOLO LECTURA. Motilart: referidos, ingresos y comisiones recientes, más las
// comisiones creadas en los últimos 3 días (para encontrar la que se hizo a mano).
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const d = (x) => (x ? new Date(x).toISOString().slice(0, 16).replace('T', ' ') : '—');
(async () => {
  const tenants = await p.tenant.findMany({
    where: { name: { contains: 'motilart', mode: 'insensitive' } },
    select: { id: true, name: true, slug: true, status: true, lastChargeAt: true, currentPeriodEnd: true, whiteLabelId: true, businessGroupId: true },
  });
  console.log('NEGOCIOS', tenants.length);
  for (const t of tenants) {
    console.log(`\n== ${t.name} (${t.slug}) id=${t.id} status=${t.status} lastCharge=${d(t.lastChargeAt)} periodEnd=${d(t.currentPeriodEnd)} grupo=${t.businessGroupId ?? '—'}`);
    const usos = await p.referralUse.findMany({
      where: { tenantId: t.id },
      select: { id: true, status: true, createdAt: true, convertedAt: true, referralCode: { select: { id: true, code: true, ownerName: true, role: true, isActive: true, commissionPercent: true, parentCodeId: true, parentEmbajadorCodeId: true } } },
    });
    for (const u of usos) console.log(`  USO ${u.id} ${u.status} creado ${d(u.createdAt)} conv ${d(u.convertedAt)} → ${u.referralCode.ownerName} [${u.referralCode.code}] ${u.referralCode.role} activo=${u.referralCode.isActive} ${u.referralCode.commissionPercent}% padre=${u.referralCode.parentCodeId ?? '—'} padreEmb=${u.referralCode.parentEmbajadorCodeId ?? '—'}`);
    const coms = await p.commission.findMany({
      where: { OR: [{ referralUse: { tenantId: t.id } }, { ventaTenantId: t.id }] },
      orderBy: { createdAt: 'asc' },
      select: { id: true, amount: true, status: true, paymentStatus: true, createdAt: true, businessDate: true, availableAt: true, periodKey: true, externalTxId: true, notes: true, baseAmountUsd: true, appliedPercent: true, participacionId: true, payoutBatch: { select: { code: true } }, recipientCode: { select: { ownerName: true, code: true } } },
    });
    for (const c of coms) console.log(`  COM ${c.id.slice(0, 8)} $${c.amount} ${c.status}/${c.paymentStatus} a ${c.recipientCode?.ownerName ?? '—'} creada ${d(c.createdAt)} negocio ${d(c.businessDate)} disp ${d(c.availableAt)} period=${c.periodKey} tx=${c.externalTxId ?? '—'} base=${c.baseAmountUsd ?? '—'} %=${c.appliedPercent ?? '—'} part=${c.participacionId ? 'sí' : 'no'} corte=${c.payoutBatch?.code ?? '—'} nota=${(c.notes ?? '').slice(0, 80)}`);
    const ing = await p.incomeRecord.findMany({
      where: { tenantId: t.id },
      orderBy: { saleDate: 'asc' },
      select: { externalTxId: true, gateway: true, grossUsd: true, saleDate: true, status: true, category: true, createdAt: true },
    });
    for (const i of ing) console.log(`  ING ${d(i.saleDate)} ${i.gateway} ${i.externalTxId} $${i.grossUsd} ${i.status} ${i.category} creado ${d(i.createdAt)}`);
  }
  const desde = new Date(Date.now() - 3 * 86400000);
  const recientes = await p.commission.findMany({
    where: { createdAt: { gte: desde } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, amount: true, status: true, createdAt: true, periodKey: true, notes: true, ventaTenantId: true, businessGroupId: true, recipientCode: { select: { ownerName: true } }, referralUse: { select: { tenant: { select: { name: true } } } } },
  });
  console.log(`\nCOMISIONES CREADAS DESDE ${d(desde)}: ${recientes.length}`);
  for (const c of recientes) console.log(`  ${d(c.createdAt)} ${c.id.slice(0, 8)} $${c.amount} ${c.status} a ${c.recipientCode?.ownerName ?? '—'} negocio=${c.referralUse?.tenant?.name ?? c.ventaTenantId ?? (c.businessGroupId ? 'grupo ' + c.businessGroupId : '—')} period=${c.periodKey} nota=${(c.notes ?? '').slice(0, 60)}`);
  const logs = await p.auditLog.findMany({
    where: { createdAt: { gte: desde }, OR: [{ action: { contains: 'commission', mode: 'insensitive' } }, { action: { contains: 'comision', mode: 'insensitive' } }, { action: { contains: 'referral', mode: 'insensitive' } }, { action: { contains: 'income', mode: 'insensitive' } }] },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`\nAUDITLOG RECIENTE: ${logs.length}`);
  for (const l of logs) console.log(`  ${d(l.createdAt)} ${l.action} ${l.entityType ?? ''} ${l.entityId ?? ''} ${JSON.stringify(l.metadata ?? l.details ?? {}).slice(0, 300)}`);
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; }).finally(() => p.$disconnect());
