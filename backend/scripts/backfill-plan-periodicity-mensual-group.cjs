// Backfill puntual de planPeriodicity para el bug "Sin definir" (PDF SELLEALA
// punto 3). NO deriva de nada: setea valores EXACTOS que dictó el founder para
// 2 negocios ACTIVE de un grupo empresarial mensual. Idempotente y defensivo:
// solo escribe si el registro está en NULL (nunca pisa una periodicidad ya
// puesta) y refuse-por-slug si el tenant no existe.
//
// Contexto: estos tenants nacieron antes del forward-fix (plan-from-offer.ts)
// y no persistieron offer code / precio, así que no hay dato para re-derivar.
// El founder confirmó que jamarea + hacienda-don-antonio son mensuales.
// Zekkei, Vizage MedSpa, prueba-selleala y sys-living-card se dejan "Sin
// definir" a propósito (no se tocan).
//
// NO seteamos subscriptionPriceUsd: queda null y la comisión cae a la base
// canónica por periodicidad (Mensual = 68 USD), que es lo correcto.
//
// Uso (read/verify de prod):
//   railway run --service Postgres-Nq8w node scripts/backfill-plan-periodicity-mensual-group.cjs
const { PrismaClient } = require('@prisma/client');

// slug -> periodicidad a fijar. Ampliable si el founder confirma más.
const TARGETS = {
  'jamarea-restobar-marino': 'MENSUAL',
  'hacienda-don-antonio': 'MENSUAL',
};

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL / DATABASE_PUBLIC_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  for (const [slug, period] of Object.entries(TARGETS)) {
    const t = await prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, brandName: true, planPeriodicity: true, status: true },
    });
    if (!t) {
      console.log(`• ${slug}: ✗ NO EXISTE — se omite (revisar slug).`);
      continue;
    }
    if (t.planPeriodicity != null) {
      console.log(
        `• ${slug} (${t.brandName}): ya tiene periodicidad="${t.planPeriodicity}" — NO se pisa.`,
      );
      continue;
    }
    await prisma.tenant.update({
      where: { id: t.id },
      data: { planPeriodicity: period },
    });
    console.log(
      `• ${slug} (${t.brandName}, ${t.status}): NULL → "${period}" ✓`,
    );
  }

  // Verificación final
  const after = await prisma.tenant.findMany({
    where: { slug: { in: Object.keys(TARGETS) } },
    select: { slug: true, planPeriodicity: true },
    orderBy: { slug: 'asc' },
  });
  console.log('Estado final:', JSON.stringify(after));

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
