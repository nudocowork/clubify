// #1 Hydor Coffee House — la compra REAL fue Plan MENSUAL = 50 USD.
// El sistema tenía un valor incorrecto (recalc previo lo dejó en 135).
//
// Este script:
//   1. setea Tenant.subscriptionPriceUsd = 50 y planPeriodicity = MENSUAL
//   2. recalcula las comisiones PENDING/APPROVED a base_real(50) × %
//        - directa   = % del code de quien recibe
//        - indirecta = referrals.indirectPercent (default 5%)
//   3. NO toca PAID ni REJECTED (no se cambian pagos ya hechos)
//
// Dashboard y reportes son proyecciones sobre subscriptionPriceUsd + las filas
// Commission, así que con esto quedan corregidos sin tocar nada más.
//
// Dry-run por defecto. APPLY=1 para aplicar.
//   node scripts/fix-hydor-50-mensual.cjs          (dry-run)
//   APPLY=1 node scripts/fix-hydor-50-mensual.cjs   (aplica)
const { PrismaClient } = require('@prisma/client');

const NEEDLE = 'Hydor';
const REAL_PRICE = 50;
const REAL_PERIODICITY = 'MENSUAL';
const round2 = (n) => Math.round(n * 100) / 100;

(async () => {
  const apply = process.env.APPLY === '1';
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  console.log(apply ? '*** APPLY ***\n' : '*** DRY-RUN (APPLY=1 para aplicar) ***\n');

  const indRow = await prisma.setting.findUnique({ where: { key: 'referrals.indirectPercent' } });
  const indirectPct = indRow?.value ? Number(indRow.value) : 5;

  const tenants = await prisma.tenant.findMany({
    where: { brandName: { contains: NEEDLE, mode: 'insensitive' } },
    select: { id: true, brandName: true, slug: true, status: true, planPeriodicity: true, subscriptionPriceUsd: true },
  });
  if (tenants.length === 0) { console.log(`✗ "${NEEDLE}": NO encontrado`); process.exit(1); }
  if (tenants.length > 1) {
    console.log(`⚠ "${NEEDLE}": ${tenants.length} matches — abortando por ambigüedad:`);
    for (const t of tenants) console.log(`   ${t.brandName} | slug=${t.slug} | ${t.id.slice(0,8)} | ${t.status}`);
    process.exit(1);
  }
  const t = tenants[0];
  console.log(`████ ${t.brandName} | slug=${t.slug} | ${t.id.slice(0,8)} | ${t.status}`);
  console.log(`   periodicidad: ${t.planPeriodicity ?? '—'} → ${REAL_PERIODICITY}`);
  console.log(`   precioReal:   ${t.subscriptionPriceUsd ?? '—'} → $${REAL_PRICE}\n`);

  if (apply) {
    await prisma.tenant.update({
      where: { id: t.id },
      data: { subscriptionPriceUsd: REAL_PRICE, planPeriodicity: REAL_PERIODICITY },
    });
  }

  // Mostrar TODAS las no-rejected para contexto, recalcular solo PENDING/APPROVED.
  const allRows = await prisma.commission.findMany({
    where: { status: { not: 'REJECTED' }, referralUse: { tenantId: t.id } },
    select: {
      id: true, amount: true, status: true, paymentStatus: true, periodKey: true, createdAt: true,
      recipientCodeId: true,
      referralUse: { select: { referralCodeId: true } },
      recipientCode: { select: { code: true, ownerName: true, role: true, commissionPercent: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`   ${allRows.length} comisiones (no anuladas):`);

  let touched = 0;
  for (const c of allRows) {
    const d = new Date(c.createdAt).toISOString().slice(0, 10);
    const who = `${c.recipientCode?.ownerName ?? 'SIN'} (${c.recipientCode?.role ?? '—'} ${c.recipientCode?.code ?? '—'})`;
    if (c.status === 'PAID') {
      console.log(`   • $${Number(c.amount).toFixed(2)} | PAID — se respeta | ${who} | ${d}`);
      continue;
    }
    const isDirect = c.recipientCodeId === c.referralUse?.referralCodeId;
    const pct = isDirect ? Number(c.recipientCode?.commissionPercent ?? 0) : indirectPct;
    const newAmount = round2((REAL_PRICE * pct) / 100);
    const cur = Number(c.amount);
    const tag = isDirect ? `directa ${pct}%` : `indirecta ${pct}%`;
    if (Math.abs(cur - newAmount) < 0.005) {
      console.log(`   ✓ $${cur.toFixed(2)} | ${c.status}/${c.paymentStatus} | ${who} (${tag}) — ya ok`);
    } else {
      touched++;
      console.log(`   ${apply ? 'RECALC' : 'recalc'}: $${cur.toFixed(2)} → $${newAmount.toFixed(2)} | ${c.status}/${c.paymentStatus} | ${who} (${tag})`);
      if (apply) await prisma.commission.update({ where: { id: c.id }, data: { amount: newAmount } });
    }
  }

  console.log(`\n${apply ? 'APLICADO' : 'Dry-run'}: ${touched} comisión(es) ${apply ? 'recalculadas' : 'a recalcular'}. PAID/REJECTED intactas.`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
