// Motilart (2026-11-16): deja bien el pago por fuera del 7-nov y su comisión.
//  1. Fecha de cobro 22-dic → 22-nov: la que registró pasar-a-pago-por-fuera
//     (nota del 8 y 9-nov). La corrió la regla 2 de pago-con-fecha-vieja: un
//     mes gratis.
//  2. Las 2 comisiones creadas hoy con «Generar comisión ahora» se fecharon
//     HOY (16-nov, disponibles 1-dic → corte de diciembre) por esa fecha mal.
//     Pasan a la fecha del pago (7-nov) y se desbloquean el 22-nov → corte del
//     30-nov. La de Santiago llevaba la transacción de septiembre: se quita.
//  3. Los 2 afiliados vuelven de CHURNED (los dejó así la cancelación de
//     Hotmart del 4-nov) a PAYING: el negocio sigue pagando, por fuera.
// Por defecto solo muestra. Escribe con --aplicar.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const APLICAR = process.argv.includes('--aplicar');
const TID = 'e08bfc71-d854-4d3c-bb02-accf10a22c17';
const PAGO = new Date('2026-11-07T17:00:00Z');
const DISPONIBLE = new Date('2026-11-22T17:00:00Z');
const PROXIMO_COBRO = new Date('2026-11-22T12:00:00Z');
const d = (x) => (x ? new Date(x).toISOString().slice(0, 16).replace('T', ' ') : '—');
(async () => {
  const t = await p.tenant.findUnique({ where: { id: TID }, select: { brandName: true, manualPayment: true, currentPeriodEnd: true, lastChargeAt: true } });
  const coms = await p.commission.findMany({
    where: { referralUse: { tenantId: TID }, createdAt: { gte: new Date('2026-11-16T00:00:00Z') }, status: 'PENDING', payoutBatchId: null },
    select: { id: true, amount: true, businessDate: true, availableAt: true, externalTxId: true, notes: true, recipientCode: { select: { ownerName: true } } },
  });
  const usos = await p.referralUse.findMany({ where: { tenantId: TID, status: 'CHURNED' }, select: { id: true, referralCode: { select: { ownerName: true } } } });
  console.log(`${t.brandName}: próximo cobro ${d(t.currentPeriodEnd)} → ${d(PROXIMO_COBRO)} (último pago ${d(t.lastChargeAt)}, por fuera=${t.manualPayment})`);
  for (const c of coms) console.log(`  comisión ${c.recipientCode?.ownerName} $${c.amount}: fecha ${d(c.businessDate)} → ${d(PAGO)} · disponible ${d(c.availableAt)} → ${d(DISPONIBLE)} · tx ${c.externalTxId ?? '—'} → —`);
  for (const u of usos) console.log(`  afiliado ${u.referralCode.ownerName}: CHURNED → PAYING`);
  if (coms.length !== 2) throw new Error(`Se esperaban 2 comisiones de hoy sin corte y hay ${coms.length}. No se toca nada.`);
  if (!t.manualPayment || t.lastChargeAt?.getTime() !== PAGO.getTime()) throw new Error('El negocio ya no está como se diagnosticó. No se toca nada.');
  if (!APLICAR) { console.log('\nSimulación: no se escribió nada. Repite con --aplicar.'); return; }
  const nota = 'Pago por fuera del 7-nov (transferencia, 50 USD). Fecha corregida el 16-nov: se había fechado el día en que se generó a mano.';
  await p.$transaction([
    p.tenant.update({ where: { id: TID }, data: { currentPeriodEnd: PROXIMO_COBRO } }),
    ...coms.map((c) => p.commission.update({ where: { id: c.id }, data: { businessDate: PAGO, availableAt: DISPONIBLE, externalTxId: null, notes: c.notes ? `${c.notes}\n${nota}` : nota } })),
    p.referralUse.updateMany({ where: { tenantId: TID, status: 'CHURNED' }, data: { status: 'PAYING' } }),
    p.auditLog.create({ data: { tenantId: TID, action: 'commission.fecha_corregida', resource: 'commission', metadata: { motivo: 'Motilart: comisión del pago por fuera del 7-nov fechada el 16-nov', comisiones: coms.map((c) => c.id), businessDate: PAGO, availableAt: DISPONIBLE, afiliadosRevividos: usos.map((u) => u.id), proximoCobro: { antes: t.currentPeriodEnd, ahora: PROXIMO_COBRO } } } }),
  ]);
  console.log('\nListo.');
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; }).finally(() => p.$disconnect());
