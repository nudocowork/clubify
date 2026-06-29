// Pone en CERO el contador de comisiones RECHAZADAS (card "RECHAZADAS" del panel
// /admin/commissions). Las comisiones REJECTED son anuladas (sin impacto en
// totales/pagos), el card solo las cuenta. Este script las BORRA para reiniciar
// el conteo; de ahora en adelante un rechazo nuevo crea una fila REJECTED y el
// card vuelve a contar solo (sin tocar nada del flujo).
//
// Dry-run por defecto (muestra cuántas y el total, desglosado por marca).
// APPLY=1 borra. Scope: por defecto TODAS las marcas; SCOPE=clubify limita a
// los negocios de Clubify (whiteLabelId null).
//
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/clear-rejected-commissions.cjs
//   railway run --service Postgres-Nq8w bash -c 'APPLY=1 node /ABS/PATH/backend/scripts/clear-rejected-commissions.cjs'
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const apply = process.env.APPLY === '1';
  const onlyClubify = (process.env.SCOPE || '').toLowerCase() === 'clubify';
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const where = {
    status: 'REJECTED',
    ...(onlyClubify
      ? { referralUse: { tenant: { whiteLabelId: null } } }
      : {}),
  };

  const rejected = await prisma.commission.findMany({
    where,
    select: {
      id: true,
      amount: true,
      referralUse: {
        select: { tenant: { select: { whiteLabelId: true, whiteLabel: { select: { name: true } } } } },
      },
    },
  });

  const total = rejected.reduce((s, c) => s + Number(c.amount), 0);
  const byBrand = {};
  for (const c of rejected) {
    const brand = c.referralUse?.tenant?.whiteLabel?.name || 'Clubify (sin marca)';
    byBrand[brand] = (byBrand[brand] || 0) + 1;
  }

  console.log(
    `${rejected.length} comisiones RECHAZADAS · total $${total.toFixed(2)} (${apply ? 'BORRANDO' : 'DRY-RUN'}${onlyClubify ? ', scope=clubify' : ', todas las marcas'})`,
  );
  for (const [brand, n] of Object.entries(byBrand)) {
    console.log(`  ${brand}: ${n}`);
  }

  if (apply && rejected.length) {
    const res = await prisma.commission.deleteMany({ where });
    console.log(`\n✅ Borradas: ${res.count}. El card "RECHAZADAS" queda en $0 / 0.`);
  } else if (!apply) {
    console.log("\nRe-corre con bash -c 'APPLY=1 node ...' para borrar.");
  }

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
