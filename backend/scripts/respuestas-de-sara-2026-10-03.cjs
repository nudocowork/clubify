/**
 * Lo que Sara decidió el 2026-10-03 (PDF «Software Clubify (11)»). Idempotente:
 * cada paso mira el estado antes de escribir. Simula por defecto.
 *
 *  1. Café Macondo pasa a MENSUAL. Su último plan (17-sep, `D99G58Q2`) es una
 *     mensualidad de $52,24: el trimestral de junio no se renovó. El libro lo
 *     tenía como $150 (precio de la periodicidad vieja) y su comisión, $15.
 *  2. Grupo Mística: la comisión del cobro del 17-jul (HP1340155988, $150) no
 *     se generó (su mes ya estaba ocupado). Se crea, 10 % = $15, para pagar en
 *     el corte del 30-sep.
 *  3. Los «Servicios adicionales» de ~$20: fuera de Contabilidad hasta que se
 *     decida qué son, pero sin borrarlos (estado EN_REVISION).
 *
 *   railway run --service Postgres-Nq8w node scripts/respuestas-de-sara-2026-10-03.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
  transactionOptions: { timeout: 60000, maxWait: 20000 },
});
const APLICAR = process.argv.includes('--aplicar');
const r2 = (n) => Math.round(n * 100) / 100;
const log = (s) => console.log(`${APLICAR ? 'APLICO' : 'simulo'} ${s}`);

async function pct(key, def) {
  const s = await p.setting.findUnique({ where: { key } });
  const n = Number(s?.value);
  return Number.isFinite(n) ? n : def;
}

(async () => {
  // ── 1. Café Macondo a mensual ──────────────────────────────────────────
  const MENSUAL_USD = 52.24;
  const mac = await p.tenant.findFirst({
    where: { brandName: 'Café Macondo', deletedAt: null },
    select: { id: true, planPeriodicity: true, subscriptionPriceUsd: true, currentPeriodEnd: true, hotmartSubscriberCode: true },
  });
  if (!mac) throw new Error('No encuentro Café Macondo');
  if (mac.planPeriodicity !== 'MENSUAL' || Number(mac.subscriptionPriceUsd) !== MENSUAL_USD) {
    log(`Café Macondo: ${mac.planPeriodicity} → MENSUAL, precio pactado → $${MENSUAL_USD} (código ${mac.hotmartSubscriberCode}, próximo cobro ${mac.currentPeriodEnd?.toISOString().slice(0, 10)})`);
    if (APLICAR) await p.tenant.update({ where: { id: mac.id }, data: { planPeriodicity: 'MENSUAL', subscriptionPriceUsd: MENSUAL_USD } });
  }
  const fila = await p.incomeRecord.findFirst({ where: { externalTxId: 'HP3836714159' } });
  if (fila && Number(fila.grossUsd) !== MENSUAL_USD) {
    const fee = r2((MENSUAL_USD * (await pct('finance.gatewayFeePct.HOTMART', 0))) / 100);
    const tax = r2((MENSUAL_USD * (await pct('finance.taxPct', 0))) / 100);
    log(`libro HP3836714159: $${fila.grossUsd} → $${MENSUAL_USD} (fee $${fee}, impuesto $${tax}, neto $${r2(MENSUAL_USD - fee - tax)}), mensual`);
    if (APLICAR) {
      await p.incomeRecord.update({
        where: { id: fila.id },
        data: {
          grossUsd: MENSUAL_USD,
          gatewayFeeUsd: fee,
          taxUsd: tax,
          netExpectedUsd: r2(MENSUAL_USD - fee - tax),
          planPeriodicity: 'MENSUAL',
          note: 'Plan mensual (17-sep, D99G58Q2): antes $150 por la periodicidad trimestral vieja. Sara, 2026-10-03.',
        },
      });
    }
  }
  const com = await p.commission.findFirst({
    where: { referralUse: { tenantId: mac.id }, OR: [{ hotmartTransactionId: 'HP3836714159' }, { externalTxId: 'HP3836714159' }] },
  });
  const pctAfiliado = 10;
  const nueva = r2((MENSUAL_USD * pctAfiliado) / 100);
  if (com && Number(com.amount) !== nueva) {
    if (com.paymentStatus !== 'PENDING' || Number(com.amountPaid) > 0) {
      console.log(`   comisión de Café Macondo ya pagada ($${com.amount}): NO se toca`);
    } else {
      log(`comisión de Café Macondo: $${com.amount} → $${nueva} (10 % de $${MENSUAL_USD})`);
      if (APLICAR) {
        await p.commission.updateMany({
          where: { id: com.id, paymentStatus: 'PENDING', amountPaid: 0 },
          data: { amount: nueva, baseAmountUsd: MENSUAL_USD, appliedPercent: pctAfiliado },
        });
      }
    }
  }

  // ── 2. Comisión de julio de Grupo Mística ─────────────────────────────────
  const GRUPO = 'd985eea7-1876-4962-beda-2dbb9bc20d30';
  const TX = 'HP1340155988';
  const ya = await p.commission.findFirst({ where: { businessGroupId: GRUPO, hotmartTransactionId: TX } });
  if (!ya) {
    const molde = await p.commission.findFirst({ where: { businessGroupId: GRUPO, periodKey: '2026-09' } });
    const corte = await p.payoutBatch.findUnique({ where: { code: 'CORTE-2026-09-30' }, select: { id: true, status: true } });
    if (!molde || !corte) throw new Error('Falta la comisión molde o el corte del 30-sep');
    if (corte.status !== 'OPEN') throw new Error('El corte del 30-sep ya no está abierto');
    log(`comisión Grupo Mística 17-jul: $15 (10 % de $150) para el afiliado del grupo → CORTE-2026-09-30`);
    if (APLICAR) {
      await p.$transaction(async (tx) => {
        await tx.commission.create({
          data: {
            businessGroupId: GRUPO,
            referralUseId: null,
            recipientCodeId: molde.recipientCodeId,
            amount: 15,
            currency: 'USD',
            status: 'APPROVED',
            paymentStatus: 'PENDING',
            amountPaid: 0,
            // El mes 2026-07 ya lo ocupa la comisión del cobro de junio: la clave
            // es el DÍA del cobro (misma regla que \`claveDelPeriodo\`).
            periodKey: '2026-07-17',
            hotmartTransactionId: TX,
            businessDate: new Date('2026-07-17T17:00:00Z'),
            availableAt: new Date(),
            baseAmountUsd: 150,
            appliedPercent: 10,
            payoutBatchId: corte.id,
            notes: 'Cobro del 17-jul que no generó comisión (su mes ya estaba ocupado). Sara, 2026-10-03: pagar en el corte del 30-sep.',
          },
        });
        const agg = await tx.commission.aggregate({
          where: { payoutBatchId: corte.id, status: { not: 'REJECTED' } },
          _sum: { amount: true },
        });
        await tx.payoutBatch.update({ where: { id: corte.id }, data: { totalUsd: r2(Number(agg._sum.amount ?? 0)) } });
      });
    }
  }

  // ── 3. Servicios adicionales en revisión ───────────────────────────────
  const EN_REVISION = ['HP2420873938', 'HP4216110662', 'HP2285994519', 'HP2182632665', 'HP4008664774', 'HP2721330536'];
  const filas = await p.incomeRecord.findMany({
    where: { externalTxId: { in: EN_REVISION }, status: 'PAGADO' },
    select: { id: true, externalTxId: true, grossUsd: true, brandName: true },
  });
  for (const f of filas) {
    log(`${f.externalTxId} $${f.grossUsd} (${f.brandName ?? 'sin negocio'}) → EN_REVISION, fuera de los totales`);
    if (APLICAR) {
      await p.incomeRecord.update({
        where: { id: f.id },
        data: { status: 'EN_REVISION', note: 'Servicios adicionales: fuera de Contabilidad hasta que se decida qué son (Sara, 2026-10-03).' },
      });
    }
  }
  if (!APLICAR) console.log('(simulación: --aplicar para escribir)');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
