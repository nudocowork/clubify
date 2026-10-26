/**
 * Saca un pago de «Pagos sin activar» SIN crear cuenta: lo marca como
 * consumido, con lo que paran los recordatorios al comprador y el aviso al
 * equipo, y deja constancia en la auditoría. Para pagos que no son de un
 * plan (p. ej. la implementación de USD 25, 27 Grados Licores, 2026-10-26).
 * Simula sin --aplicar.
 *
 *   railway run --service backend --environment production node scripts/retirar-pago-pendiente.cjs <transacción> "<motivo>" [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const [tx, motivo] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const aplicar = process.argv.includes('--aplicar');
  if (!tx || !motivo) throw new Error('Uso: node scripts/retirar-pago-pendiente.cjs <transacción> "<motivo>" [--aplicar]');
  const p = await prisma.pendingHotmartPayment.findFirst({ where: { transactionId: tx, consumedAt: null } });
  if (!p) return console.log('No hay pago pendiente sin consumir con esa transacción.');
  console.log(`${aplicar ? 'APLICANDO' : 'SIMULACIÓN'} · ${p.email} · tx ${tx} · creado ${p.createdAt.toISOString()} · motivo: ${motivo}`);
  if (!aplicar) return;
  await prisma.$transaction([
    prisma.pendingHotmartPayment.update({ where: { id: p.id }, data: { consumedAt: new Date() } }),
    prisma.auditLog.create({ data: { action: 'billing.pending_retired', resource: `pending:${p.id}`, metadata: { email: p.email, transactionId: tx, motivo } } }),
  ]);
  console.log('Listo: fuera de «Pagos sin activar»; sin más recordatorios.');
})().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
