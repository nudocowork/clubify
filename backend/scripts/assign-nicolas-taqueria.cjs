/* Asigna Nicolas (TAFMPWK5) a Taquería La Adelita vía el endpoint REAL
 * PATCH /referrals/tenants/:id/assignment (setTenantAssignment) — crea el
 * ReferralUse + genera la comisión retroactiva (idempotente, código de prod).
 * NO toca Mistika. Verifica antes/después. Usage con --commit para ejecutar. */
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();
const COMMIT = process.argv.includes('--commit');
const T = '0a3f3085-afbb-47f9-828f-a6d25e69f2da'; // Taquería
const MISTIKA_COMM = 'bd9d1181-20dc-48ba-82c7-2e886d36440e'; // comisión de Mistika (no debe cambiar)

(async () => {
  const tq = await prisma.tenant.findUnique({ where: { id: T }, select: { brandName: true, whiteLabelId: true } });
  const code = await prisma.referralCode.findUnique({ where: { code: 'TAFMPWK5' }, select: { id: true, ownerName: true } });
  // SUPER_ADMIN de la MISMA marca que Taquería (para pasar el scope por marca).
  const admin =
    (await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', whiteLabelId: tq.whiteLabelId }, select: { id: true, email: true, role: true, tenantId: true, whiteLabelId: true } })) ||
    (await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true, email: true, role: true, tenantId: true, whiteLabelId: true } }));
  console.log(`Taquería wl=${tq.whiteLabelId ?? 'null'} · code TAFMPWK5 id=${code.id} · admin=${admin.email} (wl=${admin.whiteLabelId ?? 'null'})`);

  // Estado ANTES
  const usesBefore = await prisma.referralUse.count({ where: { tenantId: T } });
  const commTotalBefore = await prisma.commission.count();
  const mistikaBefore = await prisma.commission.findUnique({ where: { id: MISTIKA_COMM }, select: { amount: true, businessGroupId: true, referralUseId: true } });
  console.log(`ANTES: Taquería referralUses=${usesBefore} · comisiones totales=${commTotalBefore} · Mistika($${Number(mistikaBefore?.amount)}) group=${mistikaBefore?.businessGroupId?.slice(0,8)} use=${mistikaBefore?.referralUseId ?? 'null'}`);

  if (!COMMIT) { console.log('\n(DRY-RUN — no llamé al endpoint. --commit para ejecutar.)'); await prisma.$disconnect(); return; }

  const token = jwt.sign({ sub: admin.id, email: admin.email, role: admin.role, tenantId: admin.tenantId, whiteLabelId: admin.whiteLabelId }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const r = await fetch(`https://api.soyclubify.com/api/referrals/tenants/${T}/assignment`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ referralCodeId: code.id }),
  });
  console.log(`\nPATCH assignment → HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);

  // Estado DESPUÉS
  const usesAfter = await prisma.referralUse.findMany({ where: { tenantId: T }, select: { referralCode: { select: { code: true, ownerName: true } } } });
  const commTaq = await prisma.commission.findMany({ where: { referralUse: { tenantId: T } }, select: { amount: true, status: true, recipientCode: { select: { code: true } } } });
  const mistikaAfter = await prisma.commission.findUnique({ where: { id: MISTIKA_COMM }, select: { amount: true, businessGroupId: true, referralUseId: true } });
  console.log(`\nDESPUÉS: Taquería referralUses=${usesAfter.map((u) => u.referralCode?.code).join(',') || '(0)'}`);
  console.log(`  comisiones de Taquería: ${commTaq.map((c) => `$${Number(c.amount)}[${c.status}]→${c.recipientCode?.code}`).join(', ') || '(0)'}`);
  console.log(`  Mistika intacta: $${Number(mistikaAfter?.amount)} group=${mistikaAfter?.businessGroupId?.slice(0,8)} use=${mistikaAfter?.referralUseId ?? 'null'} ${mistikaAfter?.businessGroupId === mistikaBefore?.businessGroupId ? '✓' : '⚠️ CAMBIÓ'}`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
