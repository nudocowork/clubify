// SOLO LECTURA: de dónde salieron las fechas de mayo/junio-temprano que enseña
// Comisiones. El backfill automático puso `businessDate = createdAt`; el panel
// (`setCommissionBusinessDate`) guarda a las 17:00 UTC en punto. La hora cruda
// delata cuál de los dos caminos fue.
// Uso: railway run --service Postgres-Nq8w node scripts/arqueo-businessdate-mayo-crudo.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const filas = await p.commission.findMany({
      where: { status: { not: 'REJECTED' }, businessDate: { lt: new Date('2026-06-14T00:00:00Z') } },
      select: {
        id: true, businessDate: true, createdAt: true, paidAt: true, amount: true,
        referralUse: { select: { tenant: { select: { brandName: true } } } },
      },
      orderBy: { businessDate: 'asc' },
    });
    for (const c of filas) {
      const hora = c.businessDate.toISOString().slice(11, 19);
      const origen = hora === '17:00:00' ? 'PANEL (17:00Z en punto)'
        : c.businessDate.getTime() === c.createdAt.getTime() ? 'backfill (= createdAt)' : 'otro';
      console.log(`${c.businessDate.toISOString()}  creada ${c.createdAt.toISOString().slice(0, 16)}  ` +
        `${String(c.referralUse?.tenant?.brandName ?? '—').padEnd(26)} $${Number(c.amount).toFixed(2).padStart(6)}  ← ${origen}`);
    }
    const audit = await p.auditLog.count({ where: { resource: { startsWith: 'commission' } } });
    console.log(`\nAuditLog con resource commission*: ${audit}`);
  } finally {
    await p.$disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
