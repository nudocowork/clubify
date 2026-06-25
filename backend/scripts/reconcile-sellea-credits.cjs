// Reconcilia los créditos de Sellea: cobra 1 crédito por cada negocio real que
// quedó ACTIVE sin consumo (Acqua Nails, Empanadas La Parada). La DEMO no cobra.
// Idempotente: si el negocio YA tiene una CreditTransaction CONSUME, lo salta.
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/reconcile-sellea-credits.cjs
const { PrismaClient } = require('@prisma/client');

const TARGETS = ['Acqua Nails', 'Empanadas La Parada'];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const wl = await prisma.whiteLabel.findFirst({ where: { slug: 'sellea' } });
  if (!wl) { console.log('No existe sellea.'); return; }
  console.log(`Antes → disponibles=${wl.creditsAvailable} usados=${wl.creditsUsed}`);

  let charged = 0;
  for (const name of TARGETS) {
    const t = await prisma.tenant.findFirst({
      where: { whiteLabelId: wl.id, brandName: name },
      select: { id: true, brandName: true, status: true },
    });
    if (!t) { console.log(`• "${name}" no encontrado — salto.`); continue; }
    const existing = await prisma.creditTransaction.findFirst({
      where: { whiteLabelId: wl.id, tenantId: t.id, type: 'CONSUME' },
    });
    if (existing) { console.log(`• "${name}" ya tiene consumo — salto (idempotente).`); continue; }

    const debit = await prisma.whiteLabel.updateMany({
      where: { id: wl.id, creditsAvailable: { gte: 1 } },
      data: { creditsAvailable: { decrement: 1 }, creditsUsed: { increment: 1 } },
    });
    if (debit.count === 0) { console.log(`• Sin créditos para cobrar "${name}" — detengo.`); break; }
    await prisma.creditTransaction.create({
      data: {
        whiteLabelId: wl.id, type: 'CONSUME', amount: -1, tenantId: t.id,
        note: `Reconciliación · ${t.brandName} (activado sin consumo)`,
      },
    });
    charged++;
    console.log(`✅ Cobrado 1 crédito a "${name}".`);
  }

  const after = await prisma.whiteLabel.findFirst({ where: { id: wl.id }, select: { creditsAvailable: true, creditsUsed: true } });
  console.log(`Después → disponibles=${after.creditsAvailable} usados=${after.creditsUsed} (cobrados ahora: ${charged})`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
