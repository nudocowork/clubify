// 2026-06-06 — Bug item 5 cleanup.
//
// Tenants que pasaron de TRIAL a ACTIVE/PAST_DUE/SUSPENDED antes del fix
// quedaron con trialEndsAt apuntando a una fecha futura. El dashboard
// mostraba "Trial: X días restantes" junto con el plan pagado.
//
// Este script limpia trialEndsAt para esos tenants. trialStartedAt y
// trialSource se preservan para analytics de conversión.
//
// Uso:
//   railway run --service Postgres-Nq8w --environment production node \
//     scripts/cleanup-active-trial-leftover.cjs
//
// Idempotente — repetirlo no rompe nada.

const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: no DATABASE_PUBLIC_URL nor DATABASE_URL en env');
    process.exit(1);
  }
  console.log('Conectando a:', url.replace(/:\/\/[^@]+@/, '://***:***@'));
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const before = await prisma.tenant.count({
    where: {
      status: { in: ['ACTIVE', 'SUSPENDED'] },
      trialEndsAt: { not: null },
    },
  });
  console.log(`Tenants con trial leftover (no-TRIAL + trialEndsAt set): ${before}`);

  if (before === 0) {
    console.log('Nada que limpiar.');
    await prisma.$disconnect();
    return;
  }

  const r = await prisma.tenant.updateMany({
    where: {
      status: { in: ['ACTIVE', 'SUSPENDED'] },
      trialEndsAt: { not: null },
    },
    data: { trialEndsAt: null },
  });
  console.log(`Limpieza completada: ${r.count} rows actualizados.`);

  await prisma.$disconnect();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
