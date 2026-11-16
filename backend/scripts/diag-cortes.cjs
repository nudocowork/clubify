// SOLO LECTURA. Lista los cortes de comisiones (PayoutBatch) en orden, con su
// número, ventana, estado y total, para saber cuál es «el corte N».
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '—');
(async () => {
  const bs = await p.payoutBatch.findMany({ orderBy: { cutoffDate: 'asc' }, include: { _count: { select: { commissions: true } } } });
  bs.forEach((b, i) => console.log(`#${i + 1} ${b.code} ${b.kind} ${b.status} ventana ${d(b.periodStart)}→${d(b.periodEnd)} corte ${d(b.cutoffDate)} total $${b.totalUsd} comisiones ${b._count.commissions} auto=${b.generatedAuto}`));
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; }).finally(() => p.$disconnect());
