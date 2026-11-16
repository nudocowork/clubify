/**
 * Solo lectura. Pagos por fuera con afiliado asignado que no dejaron comisión.
 * Uso: node scripts/diag-pagos-por-fuera-sin-comision.cjs drive habibi
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const f = (d) => (d ? new Date(d).toISOString().slice(0, 16) : '—');
(async () => {
  for (const busca of process.argv.slice(2)) {
    const ts = await p.tenant.findMany({
      where: { deletedAt: null, OR: [{ brandName: { contains: busca, mode: 'insensitive' } }, { slug: { contains: busca, mode: 'insensitive' } }] },
      select: { id: true, brandName: true, status: true, manualPayment: true, suspendedAt: true, currentPeriodEnd: true, lastChargeAt: true, planPeriodicity: true, subscriptionPriceUsd: true, canceledAt: true },
    });
    for (const t of ts) {
      console.log('\n==', t.brandName, t.id, t.status, 'manual', t.manualPayment, 'susp', f(t.suspendedAt), 'próx', f(t.currentPeriodEnd), 'últ', f(t.lastChargeAt), t.planPeriodicity, 'precio', t.subscriptionPriceUsd && Number(t.subscriptionPriceUsd));
      const mp = await p.manualPayment.findMany({ where: { tenantId: t.id }, orderBy: { paidAt: 'asc' }, select: { createdAt: true, paidAt: true, amount: true, actorId: true, periodStart: true, periodEnd: true } });
      for (const m of mp) console.log('  pago', 'pagado', f(m.paidAt), 'reg', f(m.createdAt), m.actorId ? 'panel' : 'script', Number(m.amount), f(m.periodStart), '→', f(m.periodEnd));
      const us = await p.referralUse.findMany({ where: { tenantId: t.id }, select: { id: true, status: true, referralCode: { select: { role: true, ownerName: true, isActive: true } } } });
      for (const u of us) console.log('  uso', u.status, u.referralCode.role, u.referralCode.ownerName, 'activo', u.referralCode.isActive);
      const cs = await p.commission.findMany({ where: { referralUse: { tenantId: t.id } }, orderBy: { createdAt: 'desc' }, take: 6, select: { createdAt: true, businessDate: true, amount: true, status: true } });
      for (const c of cs) console.log('  comisión', 'creada', f(c.createdAt), 'negocio', f(c.businessDate), Number(c.amount), c.status);
    }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => p.$disconnect());
