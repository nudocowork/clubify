// Anula lo que dejaron como «venta» las pruebas gratis de Hotmart (precio 0):
//  · el ingreso pasa a CANCELADO («apunte que nunca debió existir»): deja de
//    contar en Contabilidad y en el Sales Wall, y como la fila sigue ahí el
//    conciliador nocturno no la vuelve a crear;
//  · las comisiones de ese alta que no se han pagado ni están en un corte pasan
//    a REJECTED con nota.
// Sin --aplicar solo muestra lo que haría. Por defecto busca TODAS las compras
// con precio 0 que tengan ingreso PAGADO; se puede pasar una lista de tx.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const aplicar = process.argv.includes('--aplicar');
const txArgs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const NOTA = 'Anulada: venía de una prueba gratis de Hotmart (precio 0), no de un cobro. La comisión nace con el primer cobro real.';
(async () => {
  const ceros = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT payload->'data'->'purchase'->>'transaction' tx
      FROM "HotmartWebhookEvent"
     WHERE payload->>'event' IN ('PURCHASE_APPROVED','PURCHASE_COMPLETE')
       AND payload->'data'->'purchase'->'price'->>'value' IN ('0','0.0','0.00')
       AND COALESCE(payload->'data'->'purchase'->>'recurrence_number','1')::int <= 1`);
  let txs = ceros.map((c) => c.tx).filter(Boolean);
  if (txArgs.length) txs = txs.filter((t) => txArgs.includes(t));
  console.log(aplicar ? 'APLICANDO' : 'SIMULACIÓN (añade --aplicar)', '· pruebas gratis:', txs.join(', ') || 'ninguna');
  for (const tx of txs) {
    const ing = await prisma.incomeRecord.findFirst({ where: { gateway: 'HOTMART', externalTxId: tx } });
    if (!ing) { console.log(`\n${tx}: sin ingreso`); continue; }
    console.log(`\n${tx} · ${ing.brandName} · ${ing.category} USD ${ing.grossUsd} · ${ing.status}`);
    if (ing.status === 'PAGADO') {
      console.log('  ingreso → CANCELADO');
      if (aplicar) await prisma.incomeRecord.update({ where: { id: ing.id }, data: { status: 'CANCELADO', refundedAt: new Date(), note: 'Prueba gratis de Hotmart (precio 0): no fue un cobro.' } });
    }
    if (!ing.tenantId) continue;
    const desde = new Date(ing.saleDate.getTime() - 2 * 864e5);
    const hasta = new Date(ing.saleDate.getTime() + 2 * 864e5);
    const cs = await prisma.commission.findMany({
      where: {
        OR: [
          { ingresoId: ing.id },
          { hotmartTransactionId: tx },
          { referralUse: { tenantId: ing.tenantId }, createdAt: { gte: desde, lte: hasta } },
        ],
      },
      include: { recipientCode: { select: { code: true, ownerName: true } } },
    });
    for (const c of cs) {
      const pagable = ['PENDING', 'APPROVED', 'RETAINED'].includes(c.status) && Number(c.amountPaid) === 0 && !c.payoutBatchId;
      console.log(`  comisión ${c.id} · ${c.recipientCode?.ownerName ?? c.recipientCode?.code ?? '?'} · USD ${c.amount} · ${c.status}/${c.paymentStatus}${c.payoutBatchId ? ' · EN CORTE' : ''} → ${pagable ? 'REJECTED' : 'NO SE TOCA (ya pagada o en corte: revisar a mano)'}`);
      if (aplicar && pagable) {
        await prisma.commission.update({ where: { id: c.id }, data: { status: 'REJECTED', notes: [c.notes, NOTA].filter(Boolean).join(' · ') } });
      }
    }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
