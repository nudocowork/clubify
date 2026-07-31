// APLICA la regla "comisión = override manual (subscriptionPriceUsd) o canónico".
// Espeja el dry-run (dryrun-commission-canonical-fix.cjs):
//   - Tenants con subscriptionPriceUsd auto-FX (ratio 0.92..1.08 del canónico):
//       mueve el valor a lastPaymentAmountUsd (auditoría) + subscriptionPriceUsd=null
//       + recalcula sus comisiones PENDING/APPROVED a canónico (% limpio).
//   - Borderline / overrides manuales (fuera de banda, ej. $50 mensual, $135
//     trimestral, $250 Birria): SE PRESERVAN, no se tocan.
//   - PAID / ADJUSTMENT / cortes cerrados: NUNCA se tocan.
//   railway run --service Postgres-Nq8w node scripts/apply-commission-canonical-fix.cjs
const { PrismaClient } = require('@prisma/client');
const round2 = (n) => Math.round(n * 100) / 100;
const CANON_DEFAULT = { mensual: 68, trimestral: 150, semestral: 278, anual: 500 };
const LO = 0.92, HI = 1.08;
function periodKeyOf(p) {
  const s = String(p || 'MENSUAL').toUpperCase();
  if (s.startsWith('TRIM')) return 'trimestral';
  if (s.startsWith('SEM')) return 'semestral';
  if (s.startsWith('AN')) return 'anual';
  return 'mensual';
}
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const canon = { ...CANON_DEFAULT };
  for (const k of Object.keys(canon)) {
    const row = await prisma.setting.findUnique({ where: { key: `landing.plans.${k}.price` } });
    if (row?.value && !isNaN(Number(row.value))) canon[k] = Number(row.value);
  }
  console.log('Canónicos:', canon, '\n');

  const tenants = await prisma.tenant.findMany({
    where: { subscriptionPriceUsd: { not: null } },
    select: { id: true, brandName: true, name: true, planPeriodicity: true, subscriptionPriceUsd: true, lastPaymentAmountUsd: true },
  });

  let clearedTenants = 0, comUpdated = 0, deltaTotal = 0, preserved = 0;
  for (const t of tenants) {
    const pk = periodKeyOf(t.planPeriodicity);
    const cano = canon[pk];
    const sub = Number(t.subscriptionPriceUsd);
    const ratio = cano ? sub / cano : 0;
    const isFxAuto = ratio >= LO && ratio <= HI;
    const nm = t.brandName || t.name;
    if (!isFxAuto) { preserved++; continue; }

    // 1) Mover crudo a auditoría + limpiar override → base pasa a canónico.
    await prisma.tenant.update({
      where: { id: t.id },
      data: {
        subscriptionPriceUsd: null,
        ...(t.lastPaymentAmountUsd == null ? { lastPaymentAmountUsd: sub } : {}),
      },
    });
    clearedTenants++;

    // 2) Recalcular comisiones PENDING/APPROVED a canónico (% limpio). PAID no.
    const coms = await prisma.commission.findMany({
      where: { status: { in: ['PENDING', 'APPROVED'] }, referralUse: { tenantId: t.id } },
      select: { id: true, amount: true, appliedPercent: true, baseAmountUsd: true,
        recipientCode: { select: { commissionPercent: true } } },
    });
    for (const c of coms) {
      const cur = Number(c.amount);
      const base = c.baseAmountUsd != null ? Number(c.baseAmountUsd) : sub;
      const pct = c.appliedPercent != null ? Number(c.appliedPercent)
        : c.recipientCode?.commissionPercent != null ? Number(c.recipientCode.commissionPercent)
        : (base > 0 ? (cur / base) * 100 : 0);
      const next = round2((cano * pct) / 100);
      if (Math.abs(next - cur) >= 0.01) {
        await prisma.commission.update({
          where: { id: c.id },
          data: {
            amount: next,
            baseAmountUsd: cano,
            ...(c.appliedPercent == null ? { appliedPercent: round2(pct) } : {}),
          },
        });
        comUpdated++;
        deltaTotal = round2(deltaTotal + (next - cur));
        console.log(`  ✏️  ${nm.slice(0,26).padEnd(26)} ${cur.toFixed(2)} → ${next.toFixed(2)} (${pct.toFixed(1)}% de ${cano})`);
      }
    }
  }

  console.log(`\n✅ Aplicado. Tenants limpiados=${clearedTenants}  preservados(override)=${preserved}  comisiones corregidas=${comUpdated}  ΔtotalUSD=+${deltaTotal.toFixed(2)}`);
  await prisma.$disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
