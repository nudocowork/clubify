/**
 * CORRECCIÓN puntual (2026-09-01) — restaura la comisión de julio de DELIZZIBO
 * (afiliado Nicolás Quintero, TAFMPWK5, $6.80) que el cron de suspendidos
 * `reconcileSuspendedTenantsCommissions` anuló INDEBIDAMENTE.
 *
 * CAUSA (misma clase que Wok Explosivo): el cron rechazaba TODAS las comisiones
 * PENDING/APPROVED de un negocio suspendido. Delizzibo cobró el 31-jul (comisión
 * real) y se suspendió el 30-ago → el cron anuló la comisión de julio aunque ese
 * cobro fue real y NO se reembolsó (verificado: sin evento de reembolso en el
 * AuditLog). Fix del cron ya desplegado (businessDate > suspendedAt).
 *
 * QUÉ HACE (idempotente): restaura la comisión REJECTED → APPROVED y le fija
 * availableAt = businessDate + 15d (estaba en null). Guard: solo si sigue REJECTED.
 *
 * Uso:  cd backend && railway run node scripts/restore-delizzibo-july-commission.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const COMM = '338f7839-cab3-4951-84f9-fff609d3138a';
const DAY = 86400000;
const d = (x) => (x ? new Date(x).toISOString().slice(0, 19).replace('T', ' ') : '—');

(async () => {
  const c = await p.commission.findUnique({
    where: { id: COMM },
    select: {
      status: true, amount: true, businessDate: true, availableAt: true,
      recipientCode: { select: { ownerName: true, code: true } },
    },
  });
  if (!c) { console.log('No encontré la comisión.'); return p.$disconnect(); }
  console.log(`Delizzibo · ${c.recipientCode?.ownerName?.trim()} (${c.recipientCode?.code}) · $${c.amount} · [${c.status}] · biz=${d(c.businessDate)}`);
  if (c.status !== 'REJECTED') {
    console.log(`Ya no está REJECTED (está ${c.status}). No hago nada.`);
    return p.$disconnect();
  }
  const availableAt = c.availableAt ?? new Date(new Date(c.businessDate).getTime() + 15 * DAY);
  const nowAvailable = new Date(availableAt) <= new Date();
  const newStatus = nowAvailable ? 'APPROVED' : 'PENDING';
  await p.commission.update({
    where: { id: COMM },
    data: {
      status: newStatus,
      paymentStatus: 'PENDING',
      amountPaid: 0,
      paidAt: null,
      availableAt,
      notes: '[2026-09-01] Restaurada: el cron de suspendidos la anuló indebidamente (cobro real del 31-jul, sin reembolso).',
    },
  });
  console.log(`\n✓ Restaurada → ${newStatus} · disponible ${d(availableAt)} · $${c.amount} para ${c.recipientCode?.ownerName?.trim()}.`);
  await p.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await p.$disconnect(); process.exit(1); });
