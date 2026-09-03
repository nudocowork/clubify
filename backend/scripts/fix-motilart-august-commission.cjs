/**
 * CORRECCIÓN puntual (2026-09-01) — genera las comisiones FALTANTES del TERCER
 * cobro de MOTILART (renovación mensual de agosto) y corrige el período de las
 * de julio.
 *
 * QUÉ PASÓ (verificado en prod, solo-lectura):
 *   MOTILART paga mensual. Cobros reales en Hotmart: 22-jun, 22-jul y 22-ago
 *   (tx HP0274589164, $49.52, lastChargeAt=2026-08-22, ciclo hasta 2026-09-22).
 *   - jun: 2 comisiones OK (Santiago $12.50 AMB · Juan $2.50 INF), pagadas.
 *   - jul: 2 comisiones, pero se CREARON tarde (30-ago). Como periodKey usa el
 *     mes en que corre el código (monthKey()=new Date()), quedaron con período
 *     '2026-08' en vez de '2026-07' (su businessDate es 22-jul).
 *   - ago: 0 comisiones. El cobro real de agosto NO generó comisión por DOS
 *     candados que apuntan a lo mismo (dedup por createdAt en vez de businessDate):
 *       1) reconcileRecurringCommissions deduplica por createdAt≥inicioCiclo. Las
 *          de julio se insertaron el 30-ago (dentro de la ventana del ciclo de
 *          agosto: lastChargeAt−2d = 20-ago) → cree que agosto ya está cubierto.
 *       2) periodKey='2026-08' ya lo ocupan las de julio → el cobro de agosto
 *          chocaría con la UNIQUE (use, recipient, '2026-08').
 *   El arreglo SISTÉMICO va en el código (dedup por businessDate). Este script
 *   corrige el dato de Motilart aquí y ahora.
 *
 * QUÉ HACE (atómico, idempotente):
 *   A) Re-estampa las 2 comisiones de JULIO (businessDate=22-jul, período '2026-08')
 *      a período '2026-07' (su mes real). Esto además libera '2026-08'.
 *   B) Crea las 2 comisiones de AGOSTO (Santiago $12.50 · Juan $2.50), período
 *      '2026-08', businessDate=lastChargeAt (22-ago), availableAt=+15d (06-sep,
 *      queda PENDING hasta entonces; el cron la promueve sola), tx HP0274589164.
 *
 * Idempotente: si ya están en '2026-07' y ya existen las de agosto, no hace nada.
 *
 * Uso:  cd backend && railway run node scripts/fix-motilart-august-commission.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const TENANT_ID = 'e08bfc71-d854-4d3c-bb02-accf10a22c17'; // MOTILART
const TX = 'HP0274589164';
const DAY = 86400000;
const d = (x) => (x ? new Date(x).toISOString().slice(0, 19).replace('T', ' ') : '—');

// Filas de JULIO a re-estampar (verificadas en prod).
const JULY_IDS = [
  '3af38ea5-f047-49fc-9830-822b0281c152', // AMBASSADOR $12.5
  '7193ddb3-a51b-49f9-a585-b48e5f9c839f', // INFLUENCER $2.5
];

(async () => {
  const t = await p.tenant.findUnique({
    where: { id: TENANT_ID },
    select: { brandName: true, lastChargeAt: true, currentPeriodEnd: true },
  });
  if (!t) { console.log('No encontré MOTILART.'); return p.$disconnect(); }
  console.log(`MOTILART · lastChargeAt=${d(t.lastChargeAt)} · currentPeriodEnd=${d(t.currentPeriodEnd)}`);

  const businessDate = t.lastChargeAt ?? new Date('2026-08-22T13:49:07.000Z');
  if (new Date(businessDate).getUTCMonth() !== 7) {
    // Guard duro: si lastChargeAt NO es agosto, el cobro de referencia cambió;
    // abortar para no crear una comisión con businessDate equivocado.
    console.log(`⚠️  lastChargeAt no es de agosto (${d(businessDate)}). Aborto por seguridad.`);
    return p.$disconnect();
  }
  const availableAt = new Date(new Date(businessDate).getTime() + 15 * DAY);

  await p.$transaction(async (tx) => {
    // ---- A) Re-estampar julio '2026-08' → '2026-07' ----
    const julyRows = await tx.commission.findMany({
      where: { id: { in: JULY_IDS } },
      select: { id: true, amount: true, periodKey: true, businessDate: true,
        referralUseId: true, recipientCodeId: true, vendorCodeId: true,
        distributionMode: true, baseAmountUsd: true, appliedPercent: true,
        recipientCode: { select: { role: true, ownerName: true } } },
    });
    for (const r of julyRows) {
      const bizMonth = r.businessDate ? new Date(r.businessDate).getUTCMonth() : null;
      if (r.periodKey === '2026-08' && bizMonth === 6 /* julio */) {
        await tx.commission.update({ where: { id: r.id }, data: { periodKey: '2026-07' } });
        console.log(`  A) ${r.recipientCode?.role} $${r.amount}: período 2026-08 → 2026-07 ✓`);
      } else {
        console.log(`  A) ${r.recipientCode?.role} $${r.amount}: ya está en ${r.periodKey} (sin cambio)`);
      }
    }

    // ---- B) Crear agosto (clonando snapshot de las de julio) ----
    for (const r of julyRows) {
      // ¿ya existe una comisión de AGOSTO para este (use, recipient)?
      const existingAug = await tx.commission.findFirst({
        where: {
          referralUseId: r.referralUseId,
          recipientCodeId: r.recipientCodeId,
          businessDate: { gte: new Date('2026-08-01T00:00:00Z'), lt: new Date('2026-09-01T00:00:00Z') },
        },
        select: { id: true },
      });
      if (existingAug) {
        console.log(`  B) ${r.recipientCode?.role} $${r.amount}: agosto ya existe (id=${existingAug.id}), no creo`);
        continue;
      }
      const c = await tx.commission.create({
        data: {
          referralUseId: r.referralUseId,
          recipientCodeId: r.recipientCodeId,
          vendorCodeId: r.vendorCodeId,
          amount: r.amount,
          status: 'PENDING',            // availableAt 06-sep es futuro → PENDING
          paymentStatus: 'PENDING',
          amountPaid: 0,
          hotmartTransactionId: TX,     // cierra el dedup por tx en reintentos futuros
          externalTxId: TX,
          periodKey: '2026-08',
          availableAt,
          businessDate,
          distributionMode: r.distributionMode,
          baseAmountUsd: r.baseAmountUsd,
          appliedPercent: r.appliedPercent,
          notes: '[2026-09-01] Comisión del 3er cobro (renovación 22-ago). El cobro real se registró pero la generación se saltó por dedup por createdAt + colisión de periodKey (arreglo sistémico aparte).',
        },
      });
      console.log(`  B) ${r.recipientCode?.role} $${r.amount}: creada agosto id=${c.id} · PENDING · disponible ${d(availableAt)} ✓`);
    }
  });

  // Resumen final
  const all = await p.commission.findMany({
    where: { referralUse: { tenantId: TENANT_ID } },
    orderBy: { businessDate: 'asc' },
    select: { amount: true, status: true, periodKey: true, businessDate: true, availableAt: true,
      recipientCode: { select: { role: true } } },
  });
  console.log('\n=== MOTILART · comisiones tras el fix ===');
  for (const c of all) {
    console.log(`  ${(c.recipientCode?.role || '').padEnd(10)} $${c.amount} | [${c.status}] período=${c.periodKey} | biz=${d(c.businessDate).slice(0,10)} avail=${d(c.availableAt).slice(0,10)}`);
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
