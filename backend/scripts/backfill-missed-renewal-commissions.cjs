// Backfill de comisiones DIRECTAS perdidas por el bug del guard <25 días:
// renovaciones (cobro reciente) que no generaron comisión al afiliado.
// Para Quipao Bubble Tea, Wok Explosivo, Konnys: si en el CICLO ACTUAL
// (desde lastChargeAt) NO hay comisión directa para el afiliado, la crea
// (PENDING, availableAt = lastChargeAt + 15d), replicando el monto de la
// comisión directa anterior del mismo tenant (continuidad).
//   DRY-RUN:  railway run --service Postgres-Nq8w node .../backfill-missed-renewal-commissions.cjs
//   APLICAR:  railway run --service Postgres-Nq8w bash -c 'APPLY=1 node .../backfill-missed-renewal-commissions.cjs'
const { PrismaClient } = require('@prisma/client');
const CANON = { MENSUAL: 68, TRIMESTRAL: 150, SEMESTRAL: 278, ANUAL: 500 };
const HOLD_DAYS = 15;
const DIRECT_ROLES = ['INFLUENCER', 'AMBASSADOR', 'VENDOR'];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const APPLY = process.env.APPLY === '1';
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM

  const patterns = ['quipao', 'wok explosivo', 'konys'];
  const tenants = await prisma.tenant.findMany({
    where: { OR: patterns.map((p) => ({ brandName: { contains: p, mode: 'insensitive' } })) },
    select: { id: true, brandName: true, planPeriodicity: true, subscriptionPriceUsd: true, lastChargeAt: true },
  });
  console.log(`Tenants: ${tenants.map((t) => t.brandName).join(', ') || 'NINGUNO'}\n`);

  for (const t of tenants) {
    if (!t.lastChargeAt) { console.log(`• ${t.brandName}: sin lastChargeAt → skip`); continue; }
    // referralUse directo vivo
    const use = await prisma.referralUse.findFirst({
      where: { tenantId: t.id, status: { in: ['PAYING', 'ACTIVE'] }, referralCode: { role: { in: DIRECT_ROLES }, isActive: true } },
      orderBy: { createdAt: 'desc' },
      include: { referralCode: { select: { id: true, code: true, ownerName: true, role: true, commissionPercent: true } },
        commissions: { orderBy: { createdAt: 'desc' } } },
    });
    if (!use) { console.log(`• ${t.brandName}: sin afiliado directo → skip`); continue; }

    const mine = use.commissions.filter((c) => c.recipientCodeId === use.referralCode.id);
    // ¿Ya hay comisión VIVA del ciclo actual (desde lastChargeAt) o del periodo?
    const live = mine.find(
      (c) => ['PENDING', 'APPROVED', 'PAID'].includes(c.status) &&
        (c.createdAt >= t.lastChargeAt || c.periodKey === monthKey),
    );
    if (live) {
      console.log(`• ${t.brandName}: YA tiene comisión viva ($${live.amount} ${live.status}, period ${live.periodKey}) → skip`);
      continue;
    }

    const base = Number(t.subscriptionPriceUsd) > 0 ? Number(t.subscriptionPriceUsd) : (CANON[t.planPeriodicity] ?? 68);
    const pct = Number(use.referralCode.commissionPercent ?? 10);
    const lastDirect = mine[0];
    const amount = lastDirect ? Number(lastDirect.amount) : Math.round(base * pct) / 100;
    const availableAt = new Date(t.lastChargeAt.getTime() + HOLD_DAYS * 86400000);

    // Si existe una REJECTED del mismo periodo (creada prematuramente por el cron
    // y anulada), la REVIVIMOS a PENDING en vez de crear otra (unique constraint).
    const rejected = mine.find((c) => c.status === 'REJECTED' && c.periodKey === monthKey);
    if (rejected) {
      console.log(`• ${t.brandName}: REVIVIR comisión REJECTED del periodo ${monthKey} → PENDING $${amount} | ${use.referralCode.ownerName} | desbloq ${availableAt.toISOString().slice(0,10)}`);
      if (APPLY) {
        await prisma.commission.update({
          where: { id: rejected.id },
          data: { status: 'PENDING', amount, baseAmountUsd: base, appliedPercent: pct, availableAt },
        });
        console.log('    ✅ revivida');
      }
      continue;
    }

    console.log(`• ${t.brandName}: CREAR comisión directa $${amount} → ${use.referralCode.ownerName || use.referralCode.code} [${use.referralCode.role}] | base $${base} | period ${monthKey} | desbloq ${availableAt.toISOString().slice(0,10)} | cobro ${t.lastChargeAt.toISOString().slice(0,10)}`);
    if (APPLY) {
      await prisma.commission.create({
        data: {
          referralUseId: use.id,
          amount,
          status: 'PENDING',
          recipientCodeId: use.referralCode.id,
          periodKey: monthKey,
          baseAmountUsd: base,
          appliedPercent: pct,
          availableAt,
        },
      });
      console.log('    ✅ creada');
    }
  }
  console.log(APPLY ? '\nAPLICADO.' : '\nDRY-RUN (nada escrito). Corré con APPLY=1 para aplicar.');
  await prisma.$disconnect(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
