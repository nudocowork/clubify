// Reactiva la comisión de JULIO (RECHAZADA) de Hydor Coffee y Quipao Tea, para
// que se DESBLOQUEE el 30 de este mes: status REJECTED → PENDING + availableAt =
// 2026-08-30 (el cron diario promotePendingToApproved la pasa a APPROVED el 30).
// Premisa (confirmada por el founder): el pago de julio SÍ existe en Hotmart.
// Solo toca ESAS 2 comisiones. Dry-run por defecto; --commit para aplicar.
// Usage: railway run --service Postgres-Nq8w node scripts/reactivate-jul-commissions-hydor-quipao.cjs [--commit]
const { PrismaClient } = require('@prisma/client');
const COMMIT = process.argv.includes('--commit');
const AVAILABLE_AT = new Date('2026-08-30T00:00:00.000Z'); // desbloqueo el 30

const TARGETS = [
  { name: 'Hydor Coffee House', tenantId: '6666b867-57dd-456f-b69f-837b69b48aba' },
  { name: 'Quipao Bubble Tea', tenantId: '2f224b27-934f-4858-8e86-a26638f8a39d' },
];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  for (const t of TARGETS) {
    const rejected = await prisma.commission.findMany({
      where: { referralUse: { tenantId: t.tenantId }, status: 'REJECTED' },
      select: { id: true, amount: true, status: true, businessDate: true, availableAt: true, recipientCode: { select: { code: true, ownerName: true } } },
    });
    console.log(`\n■ ${t.name}: ${rejected.length} comisión(es) RECHAZADA(s)`);
    if (rejected.length !== 1) {
      console.log(`  ⚠️ esperaba EXACTAMENTE 1 rechazada (la de julio). Encontré ${rejected.length}. NO toco este tenant por seguridad.`);
      continue;
    }
    const c = rejected[0];
    const bd = c.businessDate?.toISOString()?.slice(0, 10) ?? '-';
    console.log(`  comisión ${c.id}: $${Number(c.amount)} [${c.status}] bizDate=${bd} avail=${c.availableAt?.toISOString()?.slice(0,10) ?? '-'} → ${c.recipientCode?.code} (${c.recipientCode?.ownerName})`);
    console.log(`  CAMBIO: status REJECTED → PENDING · availableAt → ${AVAILABLE_AT.toISOString().slice(0,10)} (se promueve a APPROVED el 30)`);
    if (COMMIT) {
      await prisma.commission.update({ where: { id: c.id }, data: { status: 'PENDING', availableAt: AVAILABLE_AT } });
      console.log('  ✅ aplicado.');
    }
  }
  console.log(COMMIT ? '\n=== COMMIT hecho ===' : '\n=== DRY-RUN (sin cambios). Agregá --commit para aplicar. ===');
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
