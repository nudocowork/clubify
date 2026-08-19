/* Fix puntual (aprobado) del caso Taquería La Adelita:
 *  - re-apunta el ReferralUse HUÉRFANO (TAFMPWK5, tenantId=null) que tiene la
 *    comisión $15 → al tenant Taquería (así la comisión EXISTENTE se liga al
 *    negocio y aparece Nicolas). NO crea comisión nueva (reusa la que hay).
 *  - corrige el plan del tenant: ANUAL → TRIMESTRAL + currentPeriodEnd = lastChargeAt+3m.
 * Salvaguardas: write-once (solo si el use sigue con tenantId null); cuenta
 * comisiones antes/después (debe ser IGUAL); dry-run por defecto (--commit escribe).
 * Usage: railway run --service backend node scripts/fix-taqueria-adelita.cjs [--commit]
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const COMMIT = process.argv.includes('--commit');
const TENANT_ID = '0a3f3085-afbb-47f9-828f-a6d25e69f2da';
const CODE = 'TAFMPWK5';
const d = (x) => (x ? new Date(x).toISOString().slice(0, 16) : '—');

(async () => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: TENANT_ID },
    select: { id: true, brandName: true, email: true, planPeriodicity: true, lastChargeAt: true, currentPeriodEnd: true },
  });
  if (!tenant) { console.error('tenant no encontrado'); return; }

  // La(s) comisión(es) de TAFMPWK5 cuyo ReferralUse NO tiene tenant (huérfano).
  const orphanComms = await prisma.commission.findMany({
    where: { recipientCode: { code: CODE }, referralUse: { tenantId: null } },
    select: { id: true, amount: true, status: true, referralUseId: true, referralUse: { select: { id: true, tenantId: true, referralCode: { select: { code: true } } } } },
  });
  console.log(`Tenant: ${tenant.brandName} (${tenant.email}) · plan=${tenant.planPeriodicity} · lastChargeAt=${d(tenant.lastChargeAt)} · currentPeriodEnd=${d(tenant.currentPeriodEnd)}`);
  console.log(`Comisiones de ${CODE} con ReferralUse HUÉRFANO (tenant null): ${orphanComms.length}`);
  for (const c of orphanComms) console.log(`  - comm $${Number(c.amount)} [${c.status}] use=${c.referralUseId} (via ${c.referralUse?.referralCode?.code})`);

  if (orphanComms.length !== 1) {
    console.error(`\n⚠️ Esperaba EXACTAMENTE 1 use huérfano; hay ${orphanComms.length}. Aborto para no adivinar.`);
    await prisma.$disconnect(); return;
  }
  const useId = orphanComms[0].referralUseId;

  // Plan TRIMESTRAL: currentPeriodEnd = lastChargeAt + 3 meses (o ahora +3m si null).
  const base = tenant.lastChargeAt ? new Date(tenant.lastChargeAt) : new Date();
  const newPeriodEnd = new Date(base); newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 3);

  console.log(`\nCAMBIOS (${COMMIT ? 'COMMIT' : 'DRY-RUN'}):`);
  console.log(`  ReferralUse ${useId}: tenantId null → ${TENANT_ID}`);
  console.log(`  Tenant: planPeriodicity ${tenant.planPeriodicity} → TRIMESTRAL · currentPeriodEnd ${d(tenant.currentPeriodEnd)} → ${d(newPeriodEnd)}`);

  const commsBefore = await prisma.commission.count();
  console.log(`  Comisiones totales ANTES: ${commsBefore}`);

  if (!COMMIT) { console.log('\n(DRY-RUN — nada escrito. --commit para aplicar.)'); await prisma.$disconnect(); return; }

  await prisma.$transaction(async (tx) => {
    const r = await tx.referralUse.updateMany({ where: { id: useId, tenantId: null }, data: { tenantId: TENANT_ID, status: 'PAYING' } });
    if (r.count !== 1) throw new Error(`ReferralUse ya no estaba huérfano (count=${r.count}); abortado sin cambios de tenant.`);
    await tx.tenant.update({ where: { id: TENANT_ID }, data: { planPeriodicity: 'TRIMESTRAL', currentPeriodEnd: newPeriodEnd } });
  });

  const commsAfter = await prisma.commission.count();
  console.log(`\n✅ Aplicado. Comisiones totales DESPUÉS: ${commsAfter} ${commsAfter === commsBefore ? '(igual ✓ — no se duplicó)' : '⚠️ CAMBIÓ'}`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
