// Backfill del snapshot de la comisión de Valmont (base/pct vacíos → 150/10).
// NO cambia el monto ($15 ya es correcto = 10% × $150 TRIMESTRAL). Solo rellena
// baseAmountUsd y appliedPercent para que el arqueo/panel del afiliado no muestre
// "10% × $0". Dry-run por defecto; APPLY=1 para aplicar.
//   railway run --service Postgres-Nq8w node .../fix-valmont-commission-snapshot.cjs          (dry-run)
//   railway run --service Postgres-Nq8w bash -c 'APPLY=1 node .../fix-valmont-commission-snapshot.cjs'
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const APPLY = process.env.APPLY === '1';

  const t = await prisma.tenant.findFirst({
    where: { slug: { contains: 'valmont', mode: 'insensitive' } },
    select: { id: true, planPeriodicity: true, subscriptionPriceUsd: true },
  });
  const base = Number(t.subscriptionPriceUsd); // 150

  const comms = await prisma.commission.findMany({
    where: { referralUse: { tenantId: t.id } },
    select: { id: true, amount: true, baseAmountUsd: true, appliedPercent: true,
      recipientCode: { select: { commissionPercent: true } } },
  });

  console.log(`Valmont ${t.planPeriodicity} $${base} — ${comms.length} comisión(es)\n`);
  for (const c of comms) {
    const needsBase = c.baseAmountUsd == null || Number(c.baseAmountUsd) === 0;
    // pct desde el monto real (amount/base) para respetar excepciones; fallback al código.
    const pctFromAmount = base > 0 ? Math.round((Number(c.amount) / base) * 100) : null;
    const pct = pctFromAmount ?? Number(c.recipientCode?.commissionPercent ?? 10);
    const needsPct = c.appliedPercent == null || Number(c.appliedPercent) === 0;
    if (!needsBase && !needsPct) { console.log(`  · ${c.id.slice(0,8)} ya tiene snapshot ($${c.baseAmountUsd}/${c.appliedPercent}%) — skip`); continue; }
    console.log(`  · ${c.id.slice(0,8)} $${c.amount}: base ${c.baseAmountUsd ?? 'null'}→${base} | pct ${c.appliedPercent ?? 'null'}→${pct}`);
    // Verificación: amount debe ≈ pct% × base (no rompemos comisiones raras).
    const expect = Math.round(base * pct) / 100;
    if (Math.abs(expect - Number(c.amount)) > 0.5) {
      console.log(`    ⚠️ ${pct}%×$${base}=$${expect} ≠ $${c.amount} → NO toco (revisar manual)`); continue;
    }
    if (APPLY) {
      await prisma.commission.update({ where: { id: c.id }, data: { baseAmountUsd: base, appliedPercent: pct } });
      console.log('    ✅ actualizado');
    }
  }
  console.log(APPLY ? '\nAPLICADO.' : '\nDRY-RUN (nada escrito). Corré con APPLY=1 para aplicar.');
  await prisma.$disconnect(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
