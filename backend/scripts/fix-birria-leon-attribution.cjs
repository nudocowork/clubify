// Corrección contable de la atribución de Birria León.
// Estado correcto: UN solo ReferralUse (Santiago, embajador 25%) con DOS
// comisiones — Santiago $75 (25%) + Juan $15 (5% indirecto como influencer).
// Se borran las atribuciones erróneas (Juan-directo + cuenta junk) y sus
// comisiones (FK Cascade).
//
// Dry-run por defecto. Aplicar: APPLY=1
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/fix-birria-leon-attribution.cjs

const { PrismaClient } = require('@prisma/client');

function bundleMonths(p) {
  switch ((p ?? '').toUpperCase()) {
    case 'TRIMESTRAL': return 3; case 'SEMESTRAL': return 6;
    case 'ANUAL': return 12; default: return 1;
  }
}

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const APPLY = process.env.APPLY === '1';
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  console.log(`\n=== Fix atribución Birria León (${APPLY ? 'APPLY ✍️' : 'DRY-RUN 👀'}) ===\n`);

  const tenant = await prisma.tenant.findFirst({
    where: { brandName: { contains: 'Birria', mode: 'insensitive' } },
    select: { id: true, brandName: true, planPeriodicity: true, plan: { select: { priceMonthly: true } } },
  });
  if (!tenant) { console.error('Tenant no encontrado'); process.exit(1); }

  const months = bundleMonths(tenant.planPeriodicity);
  const price = Number(tenant.plan?.priceMonthly ?? 0) * months;
  const DIRECT_PCT = 25, INDIRECT_PCT = 5;
  const directAmt = Math.round(price * DIRECT_PCT) / 100;
  const indirectAmt = Math.round(price * INDIRECT_PCT) / 100;
  console.log(`${tenant.brandName}: base $${price} (${months}m) → directa(25%)=$${directAmt} · indirecta(5%)=$${indirectAmt}\n`);

  const uses = await prisma.referralUse.findMany({
    where: { tenantId: tenant.id, referralCode: { role: { in: ['INFLUENCER', 'AMBASSADOR'] } } },
    include: { referralCode: { select: { id: true, code: true, ownerName: true, role: true, parentCodeId: true } } },
  });

  const keep = uses.find((u) => u.referralCode?.code === 'N3CKQGBD'); // Santiago
  if (!keep) { console.error('No se encontró el use de Santiago (N3CKQGBD)'); process.exit(1); }
  const juanCodeId = keep.referralCode.parentCodeId; // influencer parent de Santiago
  const others = uses.filter((u) => u.id !== keep.id);

  console.log(`CONSERVAR use=${keep.id.slice(0,8)} (${keep.referralCode.ownerName}, ${keep.referralCode.code})`);
  console.log(`BORRAR ${others.length} use(s) erróneos:`);
  for (const u of others) {
    const cc = await prisma.commission.count({ where: { referralUseId: u.id } });
    const paid = await prisma.commission.count({ where: { referralUseId: u.id, status: 'PAID' } });
    console.log(`  use=${u.id.slice(0,8)} ${u.referralCode.code} (${u.referralCode.ownerName}) ${u.referralCode.role} → ${cc} comisión(es), ${paid} PAID${paid ? ' ⚠️' : ''}`);
  }

  // Comisiones actuales del use que conservamos
  const keepComms = await prisma.commission.findMany({
    where: { referralUseId: keep.id },
    select: { id: true, amount: true, status: true, recipientCodeId: true, periodKey: true },
  });
  const hasSantiago = keepComms.some((c) => c.recipientCodeId === keep.referralCode.id && c.status !== 'REJECTED');
  const hasJuanIndirect = keepComms.some((c) => c.recipientCodeId === juanCodeId && c.status !== 'REJECTED');
  console.log(`\nEn el use de Santiago:`);
  console.log(`  Santiago $${directAmt} → ${hasSantiago ? 'YA EXISTE ✓' : 'crear'}`);
  console.log(`  Juan indirecta $${indirectAmt} → ${hasJuanIndirect ? 'ya existe ✓' : 'CREAR'}`);

  if (!APPLY) { console.log('\n👀 DRY-RUN: no se escribió nada. Aplicar: APPLY=1\n'); await prisma.$disconnect(); return; }

  // Guard: no borrar uses con comisiones PAID
  for (const u of others) {
    const paid = await prisma.commission.count({ where: { referralUseId: u.id, status: 'PAID' } });
    if (paid > 0) { console.error(`ABORT: use ${u.id} tiene comisiones PAID — revisar manual`); process.exit(1); }
  }
  await prisma.$transaction(async (tx) => {
    for (const u of others) {
      await tx.referralUse.delete({ where: { id: u.id } }); // cascade comisiones
    }
    if (!hasJuanIndirect && juanCodeId) {
      await tx.commission.create({
        data: {
          referralUseId: keep.id, amount: indirectAmt, status: 'PENDING',
          recipientCodeId: juanCodeId, periodKey: '2026-06',
          notes: 'Indirecta 5% influencer (corrección Birria León 2026-06-15)',
        },
      });
    }
  });
  console.log('\n✍️  Aplicado.');

  const after = await prisma.commission.findMany({
    where: { referralUse: { tenantId: tenant.id }, status: { not: 'REJECTED' } },
    select: { amount: true, recipientCode: { select: { code: true, ownerName: true } } },
  });
  console.log('Comisiones activas de Birria León ahora:');
  for (const c of after) console.log(`  $${Number(c.amount).toFixed(2)} → ${c.recipientCode?.ownerName} (${c.recipientCode?.code})`);
  await prisma.$disconnect();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
