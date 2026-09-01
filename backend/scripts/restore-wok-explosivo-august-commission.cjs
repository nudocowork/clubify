/**
 * CORRECCIÓN puntual (2026-09-01) — restaura la comisión de AGOSTO de
 * WOK EXPLOSIVO (afiliado Nicolás Quintero, TAFMPWK5) que quedó REJECTED.
 *
 * QUÉ PASÓ (verificado en prod, solo-lectura + AuditLog):
 *   Wok Explosivo (mensual, subscriber G12D7TCG) tuvo en agosto:
 *     - 03-ago: payment_succeeded (renovación REAL, extendió ciclo → 07-sep) →
 *       se creó la comisión de $5 (biz 2026-08-03, período 2026-08).
 *     - 11-ago: OTRO payment_succeeded a los 8 días que NO volvió a extender el
 *       ciclo → evento duplicado/fantasma de Hotmart.
 *     - 26-ago: payment_failed (PURCHASE_DELAYED). 31-ago: SUSPENDIDO.
 *   La comisión de agosto quedó ANULADA (REJECTED), casi seguro como efecto
 *   colateral del evento duplicado del 11-ago o de la suspensión. NO hubo
 *   reembolso ni contracargo en el registro → el dinero de agosto es real, así
 *   que a Nicolás le corresponde su comisión de $5.
 *
 * QUÉ HACE (idempotente):
 *   Restaura la comisión REJECTED de agosto → APPROVED (su availableAt=18-ago ya
 *   pasó, queda disponible para el próximo corte). paymentStatus PENDING.
 *   Guard: solo si es REJECTED, businessDate de agosto, y NO hay ya otra comisión
 *   de agosto no-rechazada para ese afiliado (para no duplicar).
 *
 * ⚠️ ANTES DE CORRER: confirmar en Hotmart que el cobro de agosto de Wok
 *   Explosivo (subscriber G12D7TCG) NO fue reembolsado. Si SÍ se reembolsó, NO
 *   correr este script (el rechazo sería correcto).
 *
 * Uso:  cd backend && railway run node scripts/restore-wok-explosivo-august-commission.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const d = (x) => (x ? new Date(x).toISOString().slice(0, 19).replace('T', ' ') : '—');

(async () => {
  const t = await p.tenant.findFirst({
    where: { brandName: { contains: 'Wok Explosivo', mode: 'insensitive' } },
    select: { id: true, brandName: true },
  });
  if (!t) { console.log('No encontré Wok Explosivo.'); return p.$disconnect(); }

  const augStart = new Date('2026-08-01T00:00:00Z');
  const augEnd = new Date('2026-09-01T00:00:00Z');

  const augComms = await p.commission.findMany({
    where: {
      referralUse: { tenantId: t.id },
      businessDate: { gte: augStart, lt: augEnd },
    },
    select: {
      id: true, amount: true, status: true, businessDate: true, availableAt: true,
      recipientCodeId: true, recipientCode: { select: { ownerName: true, code: true } },
    },
  });
  console.log(`Wok Explosivo · comisiones de agosto: ${augComms.length}`);
  for (const c of augComms) {
    console.log(`  [${c.status}] $${c.amount} ${c.recipientCode?.ownerName?.trim()} (${c.recipientCode?.code}) biz=${d(c.businessDate).slice(0,10)} avail=${d(c.availableAt).slice(0,10)}`);
  }

  const rejected = augComms.filter((c) => c.status === 'REJECTED');
  const alive = augComms.filter((c) => c.status !== 'REJECTED');
  if (!rejected.length) { console.log('No hay comisión REJECTED de agosto. Nada que restaurar.'); return p.$disconnect(); }
  if (alive.length) {
    console.log('Ya existe una comisión de agosto NO rechazada — no restauro para no duplicar.');
    return p.$disconnect();
  }

  // Restaurar UNA (la del afiliado). Si hubiera varias rejected del mismo recipiente,
  // restauramos la más reciente por businessDate y dejamos las otras (duplicados reales).
  const target = rejected.sort((a, b) => new Date(b.businessDate) - new Date(a.businessDate))[0];
  const nowAvailable = target.availableAt && new Date(target.availableAt) <= new Date();
  const newStatus = nowAvailable ? 'APPROVED' : 'PENDING';

  await p.commission.update({
    where: { id: target.id },
    data: {
      status: newStatus,
      paymentStatus: 'PENDING',
      amountPaid: 0,
      paidAt: null,
      notes: '[2026-09-01] Restaurada: se anuló por efecto colateral del evento duplicado de Hotmart (11-ago) / suspensión; el cobro real de agosto (03-ago) no tuvo reembolso.',
    },
  });
  console.log(`\n✓ Restaurada comisión ${target.id} → ${newStatus} ($${target.amount}, ${target.recipientCode?.ownerName?.trim()}).`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
