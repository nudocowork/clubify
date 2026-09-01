/**
 * CORRECCIÓN puntual (2026-08-31) — genera la comisión FALTANTE de CHANFLE
 * RESTAURANTE TEMÁTICO para Nicolás (TAFMPWK5).
 *
 * CAUSA: el pago Hotmart activó la cuenta el 2026-08-25 00:23:30, pero la
 * atribución al afiliado se creó 15h DESPUÉS (15:41:43). La comisión se genera
 * EN EL PAGO; sin afiliado en ese instante, no se generó, y asignarlo después no
 * la crea sola. (Patrón "atribución tardía → sin comisión".)
 *
 * MONTO (decisión del dueño): $6.80 = base canónica mensual $68 × 10% (CHANFLE
 * tiene subscriptionPriceUsd=null → cae al canónico, igual que BIEN MARACUCHO).
 * Hold de 15 días → disponible el 2026-09-09 (queda PENDING hasta entonces).
 *
 * Idempotente: la constraint única (referralUseId, recipientCodeId, periodKey)
 * y el guard evitan duplicar si se corre dos veces.
 *
 * Uso:  cd backend && railway run node scripts/fix-chanfle-missing-commission.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const REFERRAL_USE_ID = '39619a92-1cbc-429d-b083-fdcc636cce8d';
const TENANT_ID = '50490bb2-bb1a-4dfd-8b2c-745d8c2ebdba';
const CODE = 'TAFMPWK5';
const AMOUNT = 6.8;
const BASE = 68;
const PERCENT = 10;
const PERIOD_KEY = '2026-08';
const TX = 'HP2515640948';
const DAY = 86400000;
const d = (x) => (x ? new Date(x).toISOString().slice(0, 19).replace('T', ' ') : '—');

(async () => {
  const code = await p.referralCode.findFirst({ where: { code: CODE }, select: { id: true, ownerName: true } });
  if (!code) { console.log('No encontré el código TAFMPWK5.'); return p.$disconnect(); }

  // Guard: ¿ya existe una comisión para este negocio/afiliado/mes?
  const dupe = await p.commission.findFirst({
    where: { referralUseId: REFERRAL_USE_ID, recipientCodeId: code.id, periodKey: PERIOD_KEY },
    select: { id: true },
  });
  if (dupe) {
    console.log(`Ya existe una comisión (id=${dupe.id}) para CHANFLE/Nicolás/${PERIOD_KEY}. No creo nada.`);
    return p.$disconnect();
  }

  // businessDate = fecha real del cobro (lastChargeAt); availableAt = +15 días.
  const t = await p.tenant.findUnique({ where: { id: TENANT_ID }, select: { lastChargeAt: true } });
  const businessDate = t?.lastChargeAt ?? new Date('2026-08-25T00:23:30.000Z');
  const availableAt = new Date(new Date(businessDate).getTime() + 15 * DAY);

  // distributionMode: opcional (null). Solo aplica cuando hay vendedor que toma
  // una tajada; para un influencer directo va null (como las otras de Nicolás).
  console.log('Creando comisión de CHANFLE:');
  console.log(`  afiliado=${code.ownerName} (${CODE})  monto=$${AMOUNT.toFixed(2)}  base=$${BASE}×${PERCENT}%`);
  console.log(`  businessDate=${d(businessDate)}  availableAt=${d(availableAt)} (hold 15d)`);

  const c = await p.commission.create({
    data: {
      referralUseId: REFERRAL_USE_ID,
      amount: AMOUNT,
      status: 'PENDING', // en hold hasta el 2026-09-09; el cron la promueve sola
      paymentStatus: 'PENDING',
      amountPaid: 0,
      recipientCodeId: code.id,
      hotmartTransactionId: TX,
      externalTxId: TX,
      periodKey: PERIOD_KEY,
      availableAt,
      businessDate,
      baseAmountUsd: BASE,
      appliedPercent: PERCENT,
      notes: '[2026-08-31] Comisión generada a mano: el pago fue antes de asignar al afiliado (atribución 15h tarde).',
    },
  });
  console.log(`\n✓ Creada comisión id=${c.id} · PENDING · disponible ${d(availableAt)}.`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
