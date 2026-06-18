// Cleanup del bug #10 (currency Hotmart infló subscriptionPriceUsd + comisiones).
//
// Detecta tenants cuyo Tenant.subscriptionPriceUsd quedó FUERA de banda
// respecto al precio canónico de su plan (porque el webhook guardó un value
// en moneda local — COP/MXN/BRL — tratándolo como USD). Para cada uno:
//   1) resetea subscriptionPriceUsd al precio canónico del bundle (USD).
//   2) escala proporcionalmente las comisiones PENDING/APPROVED del tenant
//      (newAmount = oldAmount * canonical / oldBase) — la comisión es lineal
//      en la base, así que el factor vale para cualquier % (directo/indirecto/socio).
//   3) las comisiones PAID/PARTIAL NO se tocan (ya hubo plata) → se LISTAN
//      para revisión manual.
//
// DRY-RUN por default. Para aplicar:  APPLY=1 railway run --service Postgres-Nq8w node /ABS/PATH/fix-hotmart-currency-inflation.cjs
const { PrismaClient } = require('@prisma/client');

const APPLY = process.env.APPLY === '1';
const BAND_LO = 0.3;
const BAND_HI = 1.6;

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // Precio canónico del bundle (Setting landing.plans.*.price con defaults).
  const settings = await prisma.setting.findMany({
    where: { key: { startsWith: 'landing.plans.' } },
    select: { key: true, value: true },
  });
  const sget = (k, d) => {
    const r = settings.find((s) => s.key === k);
    const n = r ? Number(r.value) : NaN;
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  const CANON = {
    MENSUAL: sget('landing.plans.mensual.price', 68),
    TRIMESTRAL: sget('landing.plans.trimestral.price', 150),
    SEMESTRAL: sget('landing.plans.semestral.price', 278),
    ANUAL: sget('landing.plans.anual.price', 500),
  };
  const canonOf = (per) => CANON[(per ?? 'MENSUAL').toUpperCase()] ?? 0;
  console.log(`MODO: ${APPLY ? 'APPLY (escribe)' : 'DRY-RUN (solo reporta)'}`);
  console.log('Bundle canónico:', JSON.stringify(CANON), '\n');

  const tenants = await prisma.tenant.findMany({
    where: { subscriptionPriceUsd: { not: null } },
    select: { id: true, brandName: true, subscriptionPriceUsd: true, planPeriodicity: true },
  });

  const affected = tenants
    .map((t) => ({ ...t, base: Number(t.subscriptionPriceUsd), canon: canonOf(t.planPeriodicity) }))
    .filter((t) => t.canon > 0 && (t.base < t.canon * BAND_LO || t.base > t.canon * BAND_HI));

  if (!affected.length) {
    console.log('No hay tenants con subscriptionPriceUsd fuera de banda ✅');
    await prisma.$disconnect();
    return;
  }

  let tenantsFixed = 0, commsScaled = 0, commsPaidFlagged = 0;
  for (const t of affected) {
    const factor = t.canon / t.base;
    console.log(`\n■ ${t.brandName} (${t.id})`);
    console.log(`  base inflada=${t.base}  →  canónico=${t.canon}  (${t.planPeriodicity || '?'})  factor=${factor.toFixed(6)}`);

    const comms = await prisma.commission.findMany({
      where: { referralUse: { tenantId: t.id }, status: { not: 'REJECTED' } },
      select: { id: true, amount: true, amountPaid: true, status: true,
        recipientCode: { select: { ownerName: true, role: true } } },
    });
    for (const c of comms) {
      const old = Number(c.amount);
      const next = Math.round(old * factor * 100) / 100;
      const who = `${c.recipientCode?.role || '?'} ${c.recipientCode?.ownerName || '?'}`;
      if (c.status === 'PAID' || c.status === 'PARTIAL' || Number(c.amountPaid) > 0) {
        console.log(`  ⚠️ PAID/PARTIAL (manual): ${who}  amount=${old}  amountPaid=${Number(c.amountPaid)}  status=${c.status}`);
        commsPaidFlagged++;
        continue;
      }
      console.log(`  · ${who}  ${old} → ${next}  (${c.status})`);
      commsScaled++;
      if (APPLY) {
        await prisma.commission.update({ where: { id: c.id }, data: { amount: next } });
      }
    }

    if (APPLY) {
      await prisma.tenant.update({
        where: { id: t.id },
        data: { subscriptionPriceUsd: t.canon },
      });
    }
    tenantsFixed++;
  }

  console.log(`\n=== RESUMEN ===`);
  console.log(`Tenants ${APPLY ? 'corregidos' : 'a corregir'}: ${tenantsFixed}`);
  console.log(`Comisiones PENDING/APPROVED ${APPLY ? 'escaladas' : 'a escalar'}: ${commsScaled}`);
  console.log(`Comisiones PAID/PARTIAL marcadas para revisión MANUAL: ${commsPaidFlagged}`);
  if (!APPLY) console.log(`\n(DRY-RUN — corré con APPLY=1 para aplicar)`);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
