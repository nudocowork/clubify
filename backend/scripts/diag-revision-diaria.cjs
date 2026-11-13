// SOLO LECTURA. Detalle de las 4 alertas de la revisión diaria del 2026-11-12:
//  1. «Fecha de cobro distinta de Hotmart»: la burguesía.
//  2. «Negocios sin ningún teléfono»: Pizzería Caracol.
//  3. «Inconsistencia de monto»: Café Macondo (comisión sobre 52,24, ingreso de 50).
//  4. «Abono fuera de Contabilidad»: los abonos de 20 que siguen EN_REVISION.
//
//   railway run --service backend --environment production --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
//     node scripts/diag-revision-diaria.cjs
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const d = (v) => (v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : '—');
const seguro = (q) => q.catch((e) => { console.log('   (no se pudo leer:', e.message.split('\n').pop(), ')'); return []; });

async function negocio(busca) {
  return seguro(p.$queryRawUnsafe(
    `SELECT id, slug, name, "brandName", status, "currentPeriodEnd", "lastChargeAt", "planPeriodicity",
            "manualPayment", "hotmartSubscriberCode", phone, "whatsappPhone", "whatsappOrdersPhone",
            "createdAt", "whiteLabelId"
       FROM "Tenant" WHERE "deletedAt" IS NULL AND (name ILIKE $1 OR "brandName" ILIKE $1 OR slug ILIKE $1)`,
    `%${busca}%`));
}

(async () => {
  // ── 1. la burguesía ─────────────────────────────────────────────────────
  console.log('########## 1. FECHA DE COBRO DISTINTA DE HOTMART');
  for (const t of await negocio('burgues')) {
    console.log(`=== ${t.name} / ${t.brandName} (${t.slug}) ${t.status} · ${t.planPeriodicity ?? '—'} · manual=${t.manualPayment} · sub=${t.hotmartSubscriberCode ?? '—'}`);
    console.log(`  Clubify: último cobro ${d(t.lastChargeAt)} · próximo cobro ${d(t.currentPeriodEnd)}`);
    const ev = await seguro(p.$queryRawUnsafe(
      `SELECT "processedAt", "eventType",
              payload->'data'->'purchase'->>'transaction' tx,
              payload->'data'->'purchase'->'offer'->>'code' oferta,
              payload->'data'->'purchase'->'price'->>'value' valor,
              payload->'data'->'purchase'->'price'->>'currency_value' moneda,
              payload->'data'->'purchase'->>'date_next_charge' prox,
              payload->'data'->'purchase'->>'recurrence_number' recurrencia,
              payload->'data'->'subscription'->'subscriber'->>'code' sub
         FROM "HotmartWebhookEvent" WHERE "tenantId" = $1 ORDER BY "processedAt" DESC LIMIT 10`, t.id));
    for (const e of ev) console.log(`  HOTMART ${d(e.processedAt)} ${e.eventType} tx=${e.tx} oferta=${e.oferta} ${e.valor} ${e.moneda ?? ''} rec=${e.recurrencia ?? '—'} próximo=${e.prox ? d(Number(e.prox)) : '—'} sub=${e.sub}`);
    const au = await seguro(p.$queryRawUnsafe(
      `SELECT "createdAt", action, left(metadata::text, 260) m FROM "AuditLog"
        WHERE "tenantId" = $1 AND "createdAt" >= now() - interval '20 days' ORDER BY "createdAt" DESC LIMIT 15`, t.id));
    for (const a of au) console.log(`  AUDIT ${d(a.createdAt)} ${a.action} ${a.m ?? ''}`);
    const mp = await seguro(p.$queryRawUnsafe(
      `SELECT "paidAt", "periodEnd", method, amount, "createdAt" FROM "ManualPayment" WHERE "tenantId" = $1 ORDER BY "paidAt" DESC LIMIT 5`, t.id));
    for (const m of mp) console.log(`  MANUAL pagó ${d(m.paidAt)} cubre hasta ${d(m.periodEnd)} ${m.method} ${m.amount} (registrado ${d(m.createdAt)})`);
  }

  // ── 2. Pizzería Caracol ─────────────────────────────────────────────────
  console.log('\n########## 2. NEGOCIO SIN NINGÚN TELÉFONO');
  for (const t of await negocio('caracol')) {
    console.log(`=== ${t.name} (${t.slug}) ${t.status} · alta ${d(t.createdAt)} · tel=${t.phone ?? '—'} wa=${t.whatsappPhone ?? '—'} waPedidos=${t.whatsappOrdersPhone ?? '—'}`);
    const us = await seguro(p.$queryRawUnsafe(
      `SELECT email, role, phone, "isActive" FROM "User" WHERE "tenantId" = $1`, t.id));
    for (const u of us) console.log(`  usuario ${u.role} · tel ${u.phone ?? '—'} · activo ${u.isActive} · correo ${u.email ? 'sí' : 'no'}`);
    // ¿Dio un teléfono al comprar? (Hotmart o pago sin activar)
    const ev = await seguro(p.$queryRawUnsafe(
      `SELECT "processedAt", "eventType", payload->'data'->'buyer'->>'checkout_phone' tel,
              payload->'data'->'buyer'->>'phone' tel2
         FROM "HotmartWebhookEvent" WHERE "tenantId" = $1 ORDER BY "processedAt" DESC LIMIT 3`, t.id));
    for (const e of ev) console.log(`  HOTMART ${d(e.processedAt)} ${e.eventType} teléfono en la compra: ${e.tel || e.tel2 ? 'SÍ' : 'no'}`);
  }

  // ── 3. Café Macondo ─────────────────────────────────────────────────────
  console.log('\n########## 3. INCONSISTENCIA DE MONTO');
  for (const t of await negocio('macondo')) {
    console.log(`=== ${t.name} (${t.slug}) ${t.status} · ${t.planPeriodicity ?? '—'}`);
    const inc = await seguro(p.$queryRawUnsafe(
      `SELECT "saleDate", "externalTxId", "grossUsd", status, gateway, "productName"
         FROM "IncomeRecord" WHERE "tenantId" = $1 ORDER BY "saleDate" DESC LIMIT 6`, t.id));
    for (const i of inc) console.log(`  INGRESO ${d(i.saleDate)} ${i.gateway} ${i.status} ${i.grossUsd} USD ${i.productName ?? ''} tx=${i.externalTxId}`);
    const com = await seguro(p.$queryRawUnsafe(
      `SELECT c.id, c."createdAt", c."businessDate", c."baseAmountUsd", c."appliedPercent", c.amount, c.currency,
              c.status, c."paymentStatus", c."amountPaid", c."periodKey", c."hotmartTransactionId", c."payoutBatchId",
              rc.code AS receptor
         FROM "Commission" c
         JOIN "ReferralUse" ru ON ru.id = c."referralUseId"
         LEFT JOIN "ReferralCode" rc ON rc.id = c."recipientCodeId"
        WHERE ru."tenantId" = $1 ORDER BY c."createdAt" DESC LIMIT 10`, t.id));
    for (const c of com) console.log(`  COMISIÓN ${c.id} ${d(c.businessDate ?? c.createdAt)} base ${c.baseAmountUsd} × ${c.appliedPercent}% = ${c.amount} ${c.currency} · ${c.status}/${c.paymentStatus} pagado ${c.amountPaid} · ${c.periodKey ?? '—'} · para ${c.receptor ?? '—'} · lote ${c.payoutBatchId ?? '—'} · tx=${c.hotmartTransactionId ?? '—'}`);
  }

  // ── 4. Abonos EN_REVISION ───────────────────────────────────────────────
  console.log('\n########## 4. ABONOS FUERA DE CONTABILIDAD');
  const ab = await seguro(p.$queryRawUnsafe(
    `SELECT i.id, i."externalTxId" tx, i."brandName", i."grossUsd", i."saleDate", i."tenantId",
            t.name AS negocio, t.status AS estado
       FROM "IncomeRecord" i LEFT JOIN "Tenant" t ON t.id = i."tenantId"
      WHERE i.status = 'EN_REVISION'
        AND i."externalTxId" IN (SELECT e.payload->'data'->'purchase'->>'transaction' FROM "HotmartWebhookEvent" e
                                  WHERE lower(e.payload->'data'->'purchase'->'offer'->>'code') = '9veek0a9')
      ORDER BY i."saleDate"`));
  for (const a of ab) {
    console.log(`  ABONO ${d(a.saleDate)} ${a.grossUsd} USD · ${a.brandName ?? '—'} · negocio ${a.negocio ?? 'SIN NEGOCIO'} (${a.estado ?? '—'}) · tx=${a.tx}`);
    if (a.tenantId) {
      const rest = await seguro(p.$queryRawUnsafe(
        `SELECT "saleDate", "grossUsd", status, "productName" FROM "IncomeRecord"
          WHERE "tenantId" = $1 AND id <> $2 ORDER BY "saleDate" LIMIT 4`, a.tenantId, a.id));
      for (const r of rest) console.log(`      otro ingreso del negocio: ${d(r.saleDate)} ${r.grossUsd} USD ${r.status} ${r.productName ?? ''}`);
    }
  }
})()
  .catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
