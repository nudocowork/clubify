// READ-ONLY. (1) Pócimas mágicas By Lauren: plan actual + comisión (¿refleja
// semestral?). (2) Veterinaria Moran: whiteLabelId/status/atribución + por qué
// aparece para uno y no para otro (Samuel 56 vs Javier 54).
const { PrismaClient } = require('@prisma/client');
const CANON = { MENSUAL: 68, TRIMESTRAL: 150, SEMESTRAL: 278, ANUAL: 500 };
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  console.log('════════ PÓCIMAS ════════');
  const poc = await prisma.tenant.findFirst({
    where: { brandName: { contains: 'cima', mode: 'insensitive' } },
    select: { id: true, brandName: true, planPeriodicity: true, subscriptionPriceUsd: true, status: true, lastChargeAt: true },
  });
  if (!poc) console.log('no encontrado (cima)');
  else {
    console.log(`${poc.brandName} | ${poc.status} | plan=${poc.planPeriodicity} | precio=$${poc.subscriptionPriceUsd ?? 'null'} | canónico=$${CANON[poc.planPeriodicity] ?? '?'}`);
    const uses = await prisma.referralUse.findMany({ where: { tenantId: poc.id }, select: { id: true, referralCode: { select: { code: true, ownerName: true, role: true, commissionPercent: true } } } });
    uses.forEach((u) => console.log(`  afiliado: ${u.referralCode?.ownerName} [${u.referralCode?.role}] ${u.referralCode?.commissionPercent}%`));
    const comms = await prisma.commission.findMany({ where: { referralUse: { tenantId: poc.id } }, select: { amount: true, status: true, baseAmountUsd: true, appliedPercent: true, periodKey: true, createdAt: true, recipientCode: { select: { ownerName: true } } }, orderBy: { createdAt: 'desc' } });
    console.log(`  comisiones (${comms.length}):`);
    comms.forEach((c) => console.log(`    $${c.amount} ${c.status} | base=$${c.baseAmountUsd ?? 'null'} pct=${c.appliedPercent ?? 'null'} | period=${c.periodKey} | ${c.recipientCode?.ownerName} | ${c.createdAt.toISOString().slice(0,10)}`));
  }

  console.log('\n════════ VETERINARIA MORAN ════════');
  const vet = await prisma.tenant.findFirst({
    where: { brandName: { contains: 'moran', mode: 'insensitive' } },
    select: { id: true, brandName: true, status: true, whiteLabelId: true, businessGroupId: true, deletedAt: true, createdAt: true, planPeriodicity: true },
  });
  if (!vet) console.log('no encontrado (moran)');
  else {
    const wl = vet.whiteLabelId ? await prisma.whiteLabel.findUnique({ where: { id: vet.whiteLabelId }, select: { name: true } }) : null;
    console.log(`${vet.brandName} | ${vet.status} | marca=${wl?.name ?? 'NULL'} | grupo=${vet.businessGroupId ?? '—'} | deleted=${vet.deletedAt ? 'SÍ' : 'no'} | creado ${vet.createdAt.toISOString().slice(0,10)}`);
    const uses = await prisma.referralUse.findMany({ where: { tenantId: vet.id }, select: { status: true, referralCode: { select: { code: true, ownerName: true, role: true, ownerUserId: true } } } });
    console.log(`  atribución (${uses.length}):`);
    uses.forEach((u) => console.log(`    ${u.referralCode?.ownerName} [${u.referralCode?.role}] use=${u.status} ownerUserId=${u.referralCode?.ownerUserId ?? '—'}`));
  }

  console.log('\n════════ SAMUEL / JAVIER (afiliados) ════════');
  const people = await prisma.referralCode.findMany({
    where: { OR: [{ ownerName: { contains: 'samuel', mode: 'insensitive' } }, { ownerName: { contains: 'javier', mode: 'insensitive' } }] },
    select: { id: true, code: true, ownerName: true, role: true, ownerUserId: true, isActive: true },
  });
  for (const p of people) {
    const nUses = await prisma.referralUse.count({ where: { referralCodeId: p.id } });
    console.log(`  ${p.ownerName} [${p.role}] code=${p.code} activo=${p.isActive} ownerUserId=${p.ownerUserId ?? '—'} → ${nUses} referralUses`);
  }

  await prisma.$disconnect(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
