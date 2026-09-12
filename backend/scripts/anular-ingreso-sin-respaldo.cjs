// Anula los ingresos del libro que NINGUNA pasarela respalda y que además son
// IMPOSIBLES: fechados antes de la primera venta de la que hay prueba.
//
// EL CASO (2026-09-12, Sara): «si no hay registro, ¿de dónde salió ese ingreso?
// Nuestra primera venta fue el 30 de mayo y aparece BUENOS DIAZ MEXICAN GRILL».
// Tenía razón. Esa fila la escribió un backfill el 31 de agosto leyendo
// `Tenant.lastChargeAt` (1 de abril) y poniéndole el precio canónico del plan.
// Pero ese `lastChargeAt` es dato SEMILLA de la migración, no un cobro de
// Clubify: el negocio se dio de alta el 8 de junio, no tiene ni un webhook de
// Hotmart, y la venta más antigua de la que existe prueba —una comisión— es del
// 26 de mayo. Un ingreso del 1 de abril no puede existir.
//
// NO BORRA: pone el estado en CANCELADO y deja la razón en la nota. Deja de
// sumar en todos los totales, el histórico sigue siendo auditable, y volver
// atrás es un solo UPDATE. Borrar una fila de un libro contable para tapar un
// error es peor que el error.
//
// Uso: railway run --service Postgres-Nq8w node scripts/anular-ingreso-sin-respaldo.cjs [--aplicar]
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');

/** La venta más antigua de la que hay prueba (comisión de Wok Explosivo). */
const PRIMERA_VENTA_PROBADA = new Date('2026-05-26T00:00:00.000Z');

const RAZON =
  'Anulado el 2026-09-12: sin respaldo en ninguna pasarela y anterior a la ' +
  'primera venta de Clubify (26-may-2026). Lo escribió un backfill desde ' +
  'Tenant.lastChargeAt, que era dato semilla de la migración, no un cobro.';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // Las mismas fuentes que audita el conciliador, para no inventar un criterio
  // distinto del que usa el módulo.
  const [filas, hotmart, stripe, manuales, packs] = await Promise.all([
    prisma.incomeRecord.findMany({
      select: { id: true, gateway: true, externalTxId: true, grossUsd: true,
                saleDate: true, brandName: true, note: true, status: true },
      orderBy: { saleDate: 'asc' },
    }),
    prisma.hotmartWebhookEvent.findMany({ select: { payload: true } }),
    prisma.stripeWebhookEvent.findMany({ select: { payload: true } }),
    prisma.manualPayment.findMany({ select: { id: true } }),
    prisma.hotmartCreditPurchase.findMany({ select: { transactionId: true } }),
  ]);

  const txHotmart = new Set([
    ...hotmart.map((e) => e.payload?.data?.purchase?.transaction).filter(Boolean),
    ...packs.map((p) => p.transactionId),
  ]);
  const txStripe = new Set(
    stripe.map((e) => e.payload?.data?.object?.id).filter(Boolean),
  );
  const idsManuales = new Set(manuales.map((m) => m.id));

  const respaldada = (r) =>
    r.gateway === 'HOTMART' ? txHotmart.has(r.externalTxId)
      : r.gateway === 'STRIPE' ? txStripe.has(r.externalTxId)
        : r.gateway === 'MANUAL' ? idsManuales.has(r.externalTxId)
          : true; // CROSS no guarda eventos: no se afirma nada

  const candidatas = filas.filter(
    (r) =>
      r.status === 'PAGADO' &&
      !respaldada(r) &&
      r.saleDate < PRIMERA_VENTA_PROBADA,
  );

  console.log(`ingresos en el libro: ${filas.length}`);
  console.log(`sin respaldo de ninguna pasarela: ${filas.filter((r) => !respaldada(r)).length}`);
  console.log(`…y además anteriores al 26-may-2026: ${candidatas.length}\n`);

  for (const r of candidatas) {
    console.log(`  ${String(r.saleDate).slice(0, 10)} ${r.gateway} $${r.grossUsd} ` +
      `${r.brandName ?? '—'} tx=${r.externalTxId}`);
    console.log(`      nota actual: ${r.note ?? '(sin nota)'}`);
  }

  if (!candidatas.length) { console.log('\nNada que anular.'); await prisma.$disconnect(); return; }

  if (!APLICAR) {
    console.log('\n-- DRY RUN. Con --aplicar quedarían en CANCELADO y dejarían de sumar.');
    await prisma.$disconnect();
    return;
  }

  for (const r of candidatas) {
    await prisma.incomeRecord.update({
      where: { id: r.id },
      data: {
        status: 'CANCELADO',
        note: `${r.note ? r.note + ' · ' : ''}${RAZON}`,
      },
    });
    console.log(`anulado ${r.id}`);
  }

  const total = await prisma.incomeRecord.aggregate({
    where: { status: 'PAGADO' },
    _sum: { grossUsd: true },
    _count: { _all: true },
  });
  console.log(`\nlibro tras la anulación: ${total._count._all} cobros · $${total._sum.grossUsd}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
