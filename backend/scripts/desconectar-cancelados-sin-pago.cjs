/**
 * Desconecta YA a quien canceló y no tiene nada pagado por delante (15-09-2026).
 *
 * Es lo mismo que desde hoy hace el cron de las 3 a. m.
 * (`suspendCanceledAtPeriodEnd`), para no esperar a la noche con los que ya
 * estaban así: VALMONT BARBERIA canceló tras dos cobros fallidos y seguía
 * activo hasta el 13-10.
 *
 * Solo negocios de Clubify: en una marca blanca, suspender debe devolver el
 * crédito de la marca, y eso lo hace el cron, no este script.
 *
 * Sin --aplicar solo lista. La escritura es condicional sobre `status: ACTIVE`:
 * si otro camino ya lo suspendió, no lo toca.
 *
 *   railway run --service Postgres-Nq8w node scripts/desconectar-cancelados-sin-pago.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');

const aplicar = process.argv.includes('--aplicar');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });

const dia = (d) => (d ? d.toISOString().slice(0, 10) : '—');

(async () => {
  const now = new Date();
  const candidatos = await prisma.tenant.findMany({
    where: {
      status: 'ACTIVE',
      canceledAt: { not: null },
      OR: [{ currentPeriodEnd: { lte: now } }, { failedPaymentCount: { gt: 0 } }],
    },
    select: {
      id: true,
      brandName: true,
      canceledAt: true,
      currentPeriodEnd: true,
      failedPaymentCount: true,
      whiteLabel: { select: { slug: true } },
    },
  });

  const deClubify = [];
  for (const t of candidatos) {
    // Sin marca = negocio histórico de Clubify, como en el resto del código.
    const marca = t.whiteLabel?.slug ?? 'clubify';
    const nota = marca === 'clubify' ? '' : '  ← marca blanca: lo hace el cron';
    console.log(
      `${t.brandName} · ${marca} · canceló ${dia(t.canceledAt)} · pagado hasta ${dia(t.currentPeriodEnd)} · cobros fallidos ${t.failedPaymentCount}${nota}`,
    );
    if (marca === 'clubify') deClubify.push(t);
  }
  console.log(`${deClubify.length} por desconectar`);
  if (!aplicar) return console.log('(sin --aplicar: no se tocó nada)');

  let n = 0;
  for (const t of deClubify) {
    const r = await prisma.tenant.updateMany({
      where: { id: t.id, status: 'ACTIVE' },
      data: { status: 'SUSPENDED', suspendedAt: now },
    });
    n += r.count;
  }
  console.log(`desconectados: ${n}`);
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
