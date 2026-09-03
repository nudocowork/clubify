/**
 * Corrige la pertenencia a corte de las comisiones mal enganchadas.
 *
 * Un corte se engancha UNA vez y nunca se revisa. Si después la comisión se
 * anula, o si se le mueve la fecha de habilitación, se queda pegada al corte
 * viejo. Eso hizo que el corte del 15-08 dijera $343.15 cuando la
 * transferencia fue de $303.85.
 *
 * Dos correcciones, solo sobre cortes ABIERTOS (nunca se toca contabilidad
 * ya cerrada):
 *
 *   1. Una comisión ANULADA no pertenece a ningún corte: no se va a transferir.
 *   2. Una comisión que se habilita después de la fecha de corte pertenece a
 *      la quincena siguiente, no a la que ya se liquidó.
 *
 * Idempotente: se puede volver a correr sin efecto.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const q = await p.payoutBatch.findFirst({
    where: { code: 'CORTE-2026-08-15' },
    select: { id: true, status: true },
  });
  const t = await p.payoutBatch.findFirst({
    where: { code: 'CORTE-2026-08-31' },
    select: { id: true, status: true },
  });
  if (!q || !t) throw new Error('falta alguno de los dos cortes');
  if (q.status !== 'OPEN' || t.status !== 'OPEN') {
    throw new Error('un corte ya no esta ABIERTO — abortado, no se toca contabilidad cerrada');
  }

  const anuladas = await p.commission.updateMany({
    where: { status: 'REJECTED', payoutBatchId: { in: [q.id, t.id] } },
    data: { payoutBatchId: null },
  });
  console.log(`anuladas desenganchadas: ${anuladas.count}`);

  const movidas = await p.commission.updateMany({
    where: {
      payoutBatchId: q.id,
      status: 'APPROVED',
      availableAt: { gt: new Date('2026-08-16T00:00:00Z') },
    },
    data: { payoutBatchId: t.id },
  });
  console.log(`movidas al corte del 31: ${movidas.count}\n`);

  for (const b of [
    { code: 'CORTE-2026-08-15', id: q.id },
    { code: 'CORTE-2026-08-31', id: t.id },
  ]) {
    const cs = await p.commission.findMany({
      where: { payoutBatchId: b.id },
      select: { amount: true, amountPaid: true },
    });
    const total = cs.reduce((s, c) => s + Number(c.amount || 0), 0);
    const pagado = cs.reduce((s, c) => s + Number(c.amountPaid || 0), 0);
    console.log(
      `${b.code}   ${String(cs.length).padStart(2)} comisiones · total $${total.toFixed(2)} · pagado $${pagado.toFixed(2)}`,
    );
  }

  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
