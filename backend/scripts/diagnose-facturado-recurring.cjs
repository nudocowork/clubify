// READ-ONLY. ¿El "Monto Facturado" refleja las mensualidades recurrentes?
// Mira: cuántos tenants ACTIVE tienen lastChargeAt, distribución por mes del
// último cobro, y cuántos parecen NO haber registrado un cobro recurrente
// (lastChargeAt ~= createdAt) aunque su ciclo ya venció.
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d30 = new Date(now.getTime() - 30 * 86400000);

  const active = await prisma.tenant.findMany({
    where: { status: 'ACTIVE', businessGroupId: null, deletedAt: null },
    select: { id: true, brandName: true, planPeriodicity: true, subscriptionPriceUsd: true,
      createdAt: true, lastChargeAt: true, currentPeriodEnd: true },
  });
  console.log(`Tenants ACTIVE (Clubify, no grupo): ${active.length}\n`);

  const noCharge = active.filter((t) => !t.lastChargeAt);
  const chargedToday = active.filter((t) => t.lastChargeAt && t.lastChargeAt >= todayStart);
  const charged30 = active.filter((t) => t.lastChargeAt && t.lastChargeAt >= d30);
  // "lastChargeAt == createdAt" (mismo día) => nunca registró un cobro recurrente posterior
  const onlyInitial = active.filter((t) => t.lastChargeAt &&
    Math.abs(t.lastChargeAt.getTime() - t.createdAt.getTime()) < 2 * 86400000);

  console.log(`Con lastChargeAt: ${active.length - noCharge.length} | SIN lastChargeAt: ${noCharge.length}`);
  console.log(`Cobrados HOY: ${chargedToday.length}  → esto es lo que ve el panel en "Hoy"`);
  console.log(`Cobrados últimos 30d: ${charged30.length}`);
  console.log(`Con lastChargeAt ≈ createdAt (sin cobro recurrente posterior): ${onlyInitial.length}`);

  // Distribución del último cobro por mes
  const byMonth = {};
  for (const t of active) {
    const k = t.lastChargeAt ? t.lastChargeAt.toISOString().slice(0, 7) : 'sin-cobro';
    byMonth[k] = (byMonth[k] || 0) + 1;
  }
  console.log('\nÚltimo cobro por mes:');
  Object.entries(byMonth).sort().forEach(([m, n]) => console.log(`  ${m}: ${n}`));

  // Ciclo vencido pero sigue ACTIVE (debería haber cobrado ya = recurrencia perdida?)
  const overdue = active.filter((t) => t.currentPeriodEnd && t.currentPeriodEnd < now);
  console.log(`\nACTIVE con currentPeriodEnd VENCIDO (¿recurrencia no cobrada?): ${overdue.length}`);
  overdue.slice(0, 15).forEach((t) => console.log(`  · ${t.brandName} | ${t.planPeriodicity} | últ.cobro ${t.lastChargeAt?.toISOString().slice(0,10) || '—'} | vencía ${t.currentPeriodEnd.toISOString().slice(0,10)}`));

  // MRR aproximado (lo que DEBERÍA entrar mensualizado)
  const CANON = { MENSUAL: 68, TRIMESTRAL: 150, SEMESTRAL: 278, ANUAL: 500 };
  const MONTHS = { MENSUAL: 1, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 };
  let mrr = 0;
  for (const t of active) {
    const p = (t.planPeriodicity || 'MENSUAL').toUpperCase();
    const price = Number(t.subscriptionPriceUsd) > 0 ? Number(t.subscriptionPriceUsd) : (CANON[p] ?? 68);
    mrr += price / (MONTHS[p] ?? 1);
  }
  console.log(`\nMRR estimado (ingreso recurrente mensualizado de ${active.length} activos): $${mrr.toFixed(2)}`);

  await prisma.$disconnect(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
