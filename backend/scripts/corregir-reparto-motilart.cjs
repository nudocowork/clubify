/**
 * MOTILART, cobro del 2026-09-22 ($50): la comisión salió entera para Juan
 * Camilo Rincón (influencer, 25 % = $12,50) y Santiago Romero (embajador, quien
 * vendió) quedó en $0. Es el fallo de reparto corregido en f70aa4c: el webhook
 * elegía por fecha qué registro vendió.
 *
 * Reparto correcto: Santiago su 25 % = $12,50 (directa) y Juan su 5 % indirecto
 * = $2,50. Sin `--aplicar` solo simula. Se niega si la de Juan ya tiene pagos.
 *
 *   railway run --service backend --environment production node scripts/corregir-reparto-motilart.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const DESDE = new Date('2026-09-22T00:00:00Z');
const HASTA = new Date('2026-09-23T12:00:00Z');

(async () => {
  console.log(APLICAR ? 'APLICANDO\n' : 'SIMULACIÓN (añade --aplicar para escribir)\n');
  const ts = await p.tenant.findMany({
    where: { brandName: { contains: 'motilart', mode: 'insensitive' }, deletedAt: null },
    select: { id: true, brandName: true },
  });
  if (ts.length !== 1) throw new Error(`Esperaba 1 negocio MOTILART y hay ${ts.length}.`);
  const t = ts[0];

  const usos = await p.referralUse.findMany({
    where: { tenantId: t.id },
    select: { id: true, referralCode: { select: { id: true, code: true, ownerName: true, role: true } } },
  });
  const santiago = usos.find((u) => u.referralCode.code === 'N3CKQGBD');
  if (!santiago) throw new Error('No encuentro el registro de Santiago Romero (N3CKQGBD) en MOTILART.');

  const comisiones = await p.commission.findMany({
    where: {
      referralUseId: { in: usos.map((u) => u.id) },
      status: { not: 'REJECTED' },
      businessDate: { gte: DESDE, lt: HASTA },
    },
    select: {
      id: true, amount: true, status: true, paymentStatus: true, amountPaid: true, paidAt: true,
      recipientCodeId: true, periodKey: true, businessDate: true, availableAt: true, currency: true,
      hotmartTransactionId: true, externalTxId: true, notes: true,
      recipientCode: { select: { code: true, ownerName: true } },
    },
  });
  console.log(`${t.brandName} — comisiones del cobro del 22-sep:`);
  for (const c of comisiones) {
    console.log(`  $${Number(c.amount)} ${c.status} (${c.paymentStatus}, pagado $${Number(c.amountPaid ?? 0)}) → ${c.recipientCode?.ownerName} (${c.recipientCode?.code}) · tx ${c.hotmartTransactionId ?? c.externalTxId ?? '—'}`);
  }

  const deJuan = comisiones.filter((c) => c.recipientCode?.code === 'XYAQE6XH');
  const yaSantiago = comisiones.some((c) => c.recipientCodeId === santiago.referralCode.id);
  if (deJuan.length !== 1 || Number(deJuan[0].amount) !== 12.5) {
    console.log('\n⚠ No está como se esperaba (una de $12,50 para Juan): no se toca nada.');
    return p.$disconnect();
  }
  if (yaSantiago) {
    console.log('\n⚠ Santiago ya tiene comisión de ese cobro: no se toca nada.');
    return p.$disconnect();
  }
  const juan = deJuan[0];
  if (Number(juan.amountPaid ?? 0) > 0 || juan.status === 'PAID' || juan.paidAt) {
    console.log('\n⚠ La de Juan ya tiene pagos: no se toca, hay que decidir el descuento a mano.');
    return p.$disconnect();
  }

  console.log('\n→ Juan pasa de $12,50 a $2,50 (su 5 % indirecto).');
  console.log(`→ Se crea $12,50 para Santiago Romero (25 % de $50), mismo estado (${juan.status}), misma fecha y misma transacción.`);
  if (APLICAR) {
    const nota = 'Reparto corregido: vendió el embajador Santiago Romero; Juan Camilo cobra su 5 % indirecto (2026-10-17).';
    await p.$transaction([
      p.commission.update({
        where: { id: juan.id },
        data: { amount: 2.5, notes: [juan.notes, nota].filter(Boolean).join(' · ') },
      }),
      p.commission.create({
        data: {
          referralUseId: santiago.id,
          recipientCodeId: santiago.referralCode.id,
          amount: 12.5,
          status: juan.status,
          currency: juan.currency,
          periodKey: juan.periodKey,
          businessDate: juan.businessDate,
          availableAt: juan.availableAt,
          hotmartTransactionId: juan.hotmartTransactionId,
          externalTxId: juan.externalTxId,
          baseAmountUsd: 50,
          appliedPercent: 25,
          notes: nota,
        },
      }),
    ]);
    console.log('\n✓ hecho');
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
