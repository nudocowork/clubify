// ══════════════════════════════════════════════════════════════════════════
// PASO 4 (GATED · toca el "libro"): registrar el corte del 31/07.
// ══════════════════════════════════════════════════════════════════════════
// Marca 5 comisiones (hoy "Disponible") como PAID, paidAt=31/07/2026,
// payoutBatch=CORTE-2026-07-31. Total $79.60. Todas de Nicolas Quintero
// (TAFMPWK5). Se agrega la etiqueta "BACKFILL REM-001" a las notas para
// trazabilidad.
//
// EL LIBRO ES DERIVADO (no hay tabla JournalLine persistida): el "asiento
// Dr 2000 / Cr 1000 por $79.60 del 31/07" se MATERIALIZA solo, desde
// accounting.service, al quedar estas 5 con amountPaid>0 y paidAt=31/07. La
// verificación del brief `SUM(credit)-SUM(debit) WHERE accountCode='2000' =
// 587.45` se traduce a la identidad EQUIVALENTE sobre Commission:
//     saldo 2000 = Σ amount(status≠REJECTED) − Σ amountPaid(status≠REJECTED)
// Esa verificación corre DENTRO de la transacción; si ≠ 587.45 → ROLLBACK.
//
// GUARDS (revisión R4 / Fable):
//  - Selección por (nombre+monto) EXACTO, exactamente 1 match por fila → no
//    puede tocar D'Ponke ($50) ni la recompra de BIEN MARACUCHO de agosto.
//  - businessDate < 2026-08-01 y status=APPROVED y amountPaid=0 (idempotente:
//    un re-run no re-paga porque ya no serán APPROVED/amountPaid=0).
//  - append-only: NO edita ni borra asientos/comisiones existentes; solo
//    marca estas 5.
//
// DRY-RUN por defecto; --apply escribe. Requiere migración + PASO 3 aplicados.
// Usage: railway run --service Postgres-Nq8w node scripts/paso4-register-corte-31jul.cjs [--apply]
const { PrismaClient } = require('@prisma/client');
const r2 = (n) => Math.round(n * 100) / 100;
const day = (d) => d ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : '—';

const RECIP = 'TAFMPWK5';
const BATCH_CODE = 'CORTE-2026-07-31';
const EXPECTED = [
  ['ALTIERI', 27.8],
  ['Extreme House', 15],
  ['BIEN MARACUCHO', 6.8],
  ['Essentrix', 15],
  ['Top Man', 15],
];
const TOTAL_EXPECTED = 79.6;
const TARGET_2000 = 587.45;
const BACKFILL_TAG = 'BACKFILL REM-001';
// R4/Fable [MANDATORY]: IDs FIJADOS (del dry-run verificado). Blindan contra un
// "match único equivocado" (3 filas comparten $15) y contra drift entre el
// dry-run y el --apply. Si el set seleccionado ≠ estos 5 exactos → aborta.
const EXPECTED_IDS = new Set([
  '90dbd879-1c75-4737-b46e-80a017e4f4f1', // ALTIERI $27.80
  'bf1046b8-8f43-421a-aeab-54986c52cbb7', // Extreme House $15
  'fdda78c0-d2a9-491e-96ed-bae6cfe875bc', // BIEN MARACUCHO $6.80 (10-jul)
  'b92889d4-bb87-4fa4-bcd4-ac072dba0b6e', // Essentrix $15
  '397bde46-07b3-4d4c-a0a3-7f3ad53fe3ed', // Top Man $15
]);

async function saldo2000(client) {
  const agg = await client.commission.aggregate({
    where: { status: { not: 'REJECTED' } },
    _sum: { amount: true, amountPaid: true },
  });
  return r2(Number(agg._sum.amount ?? 0) - Number(agg._sum.amountPaid ?? 0));
}

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const APPLY = process.argv.includes('--apply');

  const batch = await prisma.payoutBatch.findUnique({ where: { code: BATCH_CODE } });
  if (!batch) { console.error(`❌ Falta el lote ${BATCH_CODE} (correr PASO 3 primero).`); process.exit(1); }

  // Candidatos: APPROVED, sin pagar, de TAFMPWK5, compra anterior a agosto.
  const candidates = await prisma.commission.findMany({
    where: {
      recipientCode: { code: RECIP },
      status: 'APPROVED',
      amountPaid: 0,
      businessDate: { lt: new Date('2026-08-01T05:00:00.000Z') },
    },
    select: {
      id: true, amount: true, notes: true, businessDate: true, status: true,
      referralUse: { select: { tenant: { select: { brandName: true } } } },
    },
  });

  // Match EXACTO por (substring nombre + monto). Exactamente 1 por esperado.
  const picked = [];
  let guardFail = 0;
  for (const [namePart, amt] of EXPECTED) {
    const m = candidates.filter((c) =>
      (c.referralUse?.tenant?.brandName || '').toLowerCase().includes(namePart.toLowerCase()) &&
      Math.abs(Number(c.amount) - amt) < 0.001);
    if (m.length !== 1) {
      guardFail++;
      console.log(`  ✗ ${namePart} $${amt}: ${m.length} matches (se esperaba 1)`);
    } else {
      picked.push(m[0]);
      console.log(`  ✓ ${(m[0].referralUse?.tenant?.brandName || '—').padEnd(26)} $${Number(m[0].amount)}  compra=${day(m[0].businessDate)}  id=${m[0].id}`);
    }
  }
  const total = r2(picked.reduce((s, c) => s + Number(c.amount), 0));
  console.log(`\n  Total seleccionado: $${total}  (esperado $${TOTAL_EXPECTED})`);
  const before = await saldo2000(prisma);
  console.log(`  Saldo cuenta 2000 AHORA: $${before}   → tras el corte debería quedar $${TARGET_2000}`);
  console.log(`  Lote ${BATCH_CODE} · paymentDate a estampar: ${new Date(batch.paymentDate).toISOString()} (día ${day(batch.paymentDate)})`);

  // R4/Fable [MANDATORY]: el set seleccionado debe ser EXACTAMENTE los 5 IDs fijados.
  const pickedIds = new Set(picked.map((c) => c.id));
  const idsMatch =
    pickedIds.size === EXPECTED_IDS.size &&
    [...EXPECTED_IDS].every((id) => pickedIds.has(id));
  if (!idsMatch) {
    console.error(`  ✗ IDs seleccionados ≠ IDs fijados. picked=[${[...pickedIds].join(', ')}]`);
  }

  if (guardFail || Math.abs(total - TOTAL_EXPECTED) > 0.01 || picked.length !== 5 || !idsMatch) {
    console.error(`\n❌ Guard falló (matches/total/count/ids). No se escribe nada.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] No se escribió nada. Selección y guards OK.`);
    console.log(`Para aplicar (tras aprobación escrita): --apply`);
    await prisma.$disconnect();
    return;
  }

  const paidAt = new Date(batch.paymentDate);
  await prisma.$transaction(async (tx) => {
    for (const c of picked) {
      const stamp = `[${day(paidAt)}] ${BACKFILL_TAG} · pago corte ${BATCH_CODE}`;
      const res = await tx.commission.updateMany({
        where: { id: c.id, status: 'APPROVED', amountPaid: 0 }, // write-once/idempotente
        data: {
          amountPaid: Number(c.amount),
          paymentStatus: 'PAID',
          status: 'PAID',
          paidAt,
          payoutBatchId: batch.id,
          // paidAtLegacy: se OMITE a propósito (R4/Fable): estas filas nunca
          // estuvieron en un corte previo; escribir null borraría un respaldo si
          // por algún motivo lo tuvieran.
          notes: c.notes ? `${c.notes}\n${stamp}` : stamp,
        },
      });
      // R4/Fable [MANDATORY]: si una fila dejó de ser APPROVED/unpaid entre el
      // select y la tx (pago/rechazo concurrente), res.count=0 → ROLLBACK. Sin
      // esto, batch.totalUsd quedaría en $79.60 con <5 filas y el chequeo de
      // 2000 no lo notaría.
      if (res.count !== 1) {
        throw new Error(`ROLLBACK: fila ${c.id} ya no está APPROVED/sin pagar (count=${res.count})`);
      }
    }
    await tx.payoutBatch.update({ where: { id: batch.id }, data: { totalUsd: total } });

    // Verificación DENTRO de la transacción (equivalente a
    // SUM(credit)-SUM(debit) de la cuenta 2000). Si no da 587.45 → ROLLBACK.
    const after = await saldo2000(tx);
    console.log(`  Saldo cuenta 2000 DESPUÉS (en tx): $${after}`);
    if (Math.abs(after - TARGET_2000) > 0.01) {
      throw new Error(`ROLLBACK: saldo 2000 = ${after} ≠ ${TARGET_2000}`);
    }
  });

  console.log(`\n✅ Corte ${BATCH_CODE} registrado: 5 comisiones PAID · $${total} · paidAt=31/07/2026.`);
  console.log(`✅ Saldo cuenta 2000 verificado = $${TARGET_2000} (dentro de la transacción).`);
  await prisma.$disconnect();
})().catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
