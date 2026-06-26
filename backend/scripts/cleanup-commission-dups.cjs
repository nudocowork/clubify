// Limpieza contable de comisiones duplicadas por el bug del cron diario.
//
// HALLAZGO (inspección 2026-06-15): cada cliente afectado YA tiene su
// comisión legítima registrada aparte, con periodKey + recipientCodeId
// seteados (creada por el código corregido). Las filas con recipientCodeId
// NULL + periodKey NULL son 100% duplicados del cron viejo (incluso con
// montos parciales mal calculados, ej $2.50 / $12.50 el primer día).
//
// Criterio (seguro y auditable):
//   - Candidatas: status='PENDING' AND recipientCodeId IS NULL.
//   - Solo se anulan las de un referralUse que YA tenga ≥1 comisión
//     legítima (recipientCodeId NOT NULL, status != REJECTED). Así nunca
//     borramos la única comisión de un cliente.
//   - Un use sin comisión legítima keyed NO se toca → se lista para
//     revisión manual.
//   - Idempotente (las rechazadas salen de PENDING). Nota de auditoría.
//
// Dry-run por defecto. Aplicar: APPLY=1
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/cleanup-commission-dups.cjs
//   APPLY=1 railway run --service Postgres-Nq8w node /ABS/PATH/.../cleanup-commission-dups.cjs

const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const APPLY = process.env.APPLY === '1';
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  console.log(`\n=== Cleanup comisiones duplicadas (${APPLY ? 'APPLY ✍️' : 'DRY-RUN 👀'}) ===\n`);

  const nullRows = await prisma.commission.findMany({
    where: { status: 'PENDING', recipientCodeId: null },
    select: { id: true, referralUseId: true, amount: true, createdAt: true },
    orderBy: [{ referralUseId: 'asc' }, { createdAt: 'asc' }],
  });

  const byUse = new Map();
  for (const r of nullRows) {
    if (!byUse.has(r.referralUseId)) byUse.set(r.referralUseId, []);
    byUse.get(r.referralUseId).push(r);
  }

  const toReject = [];
  const manualReview = [];
  let rejectSum = 0;

  console.log('use      | NULL dups | comisión legítima (keyed) existe? | acción');
  console.log('-'.repeat(78));
  for (const [useId, list] of byUse) {
    // ¿Tiene una comisión legítima (recipiente seteado, no rechazada)?
    const legit = await prisma.commission.findMany({
      where: { referralUseId: useId, recipientCodeId: { not: null }, status: { not: 'REJECTED' } },
      select: { id: true, amount: true, periodKey: true, status: true },
    });
    const sum = list.reduce((s, x) => s + Number(x.amount), 0);
    if (legit.length > 0) {
      for (const r of list) { toReject.push(r.id); rejectSum += Number(r.amount); }
      const legitSum = legit.reduce((s, x) => s + Number(x.amount), 0);
      console.log(`  ${useId.slice(0,8)} | ${String(list.length).padStart(2)} ($${sum.toFixed(2)}) | SÍ (${legit.length} keyed, $${legitSum.toFixed(2)}) | anula las ${list.length} NULL`);
    } else {
      manualReview.push({ useId, count: list.length, sum });
      console.log(`  ${useId.slice(0,8)} | ${String(list.length).padStart(2)} ($${sum.toFixed(2)}) | NO | ⚠️ REVISIÓN MANUAL (no se toca)`);
    }
  }

  const before = await prisma.commission.aggregate({ where: { status: 'PENDING' }, _count: true, _sum: { amount: true } });
  const beforeCount = before._count, beforeSum = Number(before._sum.amount ?? 0);

  console.log('\n=== ASIENTO DE AJUSTE (conciliación) ===');
  console.log(`  PENDING antes:                 ${beforeCount} filas  $${beforeSum.toFixed(2)}`);
  console.log(`  A anular (duplicados NULL):    ${toReject.length} filas  $${rejectSum.toFixed(2)}`);
  console.log(`  PENDING legítimo después:      ${beforeCount - toReject.length} filas  $${(beforeSum - rejectSum).toFixed(2)}`);
  if (manualReview.length) {
    console.log(`  ⚠️ Uses para revisión manual:  ${manualReview.length} (${manualReview.map(m => m.useId.slice(0,8)).join(', ')})`);
  }

  if (!APPLY) {
    console.log('\n👀 DRY-RUN: no se escribió nada. Para aplicar: APPLY=1 ...\n');
    await prisma.$disconnect();
    return;
  }
  if (toReject.length === 0) {
    console.log('\n✅ Nada que anular (idempotente).\n');
    await prisma.$disconnect();
    return;
  }

  const res = await prisma.commission.updateMany({
    where: { id: { in: toReject }, status: 'PENDING' },
    data: { status: 'REJECTED', notes: 'Anulada: duplicado del bug de cron diario (cleanup 2026-06-15)' },
  });
  console.log(`\n✍️  Aplicado: ${res.count} comisiones marcadas REJECTED.`);
  const after = await prisma.commission.aggregate({ where: { status: 'PENDING' }, _count: true, _sum: { amount: true } });
  console.log(`   PENDING ahora: ${after._count} filas  $${Number(after._sum.amount ?? 0).toFixed(2)}\n`);

  await prisma.$disconnect();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
