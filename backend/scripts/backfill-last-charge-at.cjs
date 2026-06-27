// PDF 752 #6 — Backfill de Tenant.lastChargeAt para que el "monto facturado"
// por rango del dashboard cuadre con datos históricos (no solo pagos nuevos).
//
// lastChargeAt = fecha real del último cobro. El webhook Hotmart y las
// activaciones manuales ya la setean de ahora en adelante; este script la
// estima para negocios ACTIVE legacy que la tienen null:
//   lastChargeAt = currentPeriodEnd − meses(periodicidad)   (último pago)
//   o, si no hay currentPeriodEnd, createdAt (pago inicial aproximado).
//
// Idempotente: solo toca tenants ACTIVE con lastChargeAt = null. No pisa los
// que ya tienen fecha real. Dry-run por defecto; APPLY=1 para escribir.
//
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/backfill-last-charge-at.cjs
//   railway run --service Postgres-Nq8w APPLY=1 node /ABS/PATH/backend/scripts/backfill-last-charge-at.cjs
const { PrismaClient } = require('@prisma/client');

const MONTHS = { MENSUAL: 1, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 };

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const apply = process.env.APPLY === '1';
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const tenants = await prisma.tenant.findMany({
    where: { status: 'ACTIVE', lastChargeAt: null },
    select: {
      id: true,
      brandName: true,
      planPeriodicity: true,
      currentPeriodEnd: true,
      createdAt: true,
    },
  });

  console.log(
    `${tenants.length} negocios ACTIVE sin lastChargeAt (${apply ? 'APLICANDO' : 'DRY-RUN'}).`,
  );

  let updated = 0;
  for (const t of tenants) {
    const months = MONTHS[t.planPeriodicity] ?? 1; // null → MENSUAL
    let when;
    if (t.currentPeriodEnd) {
      when = new Date(t.currentPeriodEnd);
      when.setDate(1); // evita overflow de setMonth en días 29-31
      when.setMonth(when.getMonth() - months);
    } else if (t.createdAt) {
      when = new Date(t.createdAt);
    } else {
      continue;
    }
    console.log(
      `  ${t.brandName} · ${t.planPeriodicity ?? 'MENSUAL'} → lastChargeAt=${when.toISOString().slice(0, 10)}`,
    );
    if (apply) {
      await prisma.tenant.update({
        where: { id: t.id },
        data: { lastChargeAt: when },
      });
    }
    updated += 1;
  }

  console.log(`\n${apply ? 'Actualizados' : 'Se actualizarían'}: ${updated}`);
  if (!apply) console.log('Re-corre con APPLY=1 para escribir.');
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
