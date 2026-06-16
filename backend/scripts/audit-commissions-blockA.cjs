#!/usr/bin/env node
/**
 * AUDITORÍA BLOQUE A — Comisiones / Hotmart (READ-ONLY, no escribe nada).
 *
 * Detecta inconsistencias de datos en PROD antes de tocar el cálculo en vivo:
 *   1. Comisiones mal calculadas (amount ≠ base × % esperado)
 *   2. Tenants con subscriptionPriceUsd null o desalineado vs precio canónico (#18)
 *   3. Vendors legacy por encima del tope (commissionPercent > % del padre)
 *   4. Pagos parciales que descuadran Dashboard vs Referidos/Comisiones (#14/#37)
 *   5. Duplicados por ciclo (referralUseId, recipientCodeId, periodKey)
 *   6. Comisiones vivas apuntando a codes inactivos / tenants borrados (#4/#7)
 *   7. Reconciliación de totales: pending según cada superficie + gap
 *
 * Uso (el dueño lo corre — trae PII de afiliados, por eso no lo corro yo):
 *   railway run --service Postgres-Nq8w \
 *     node /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/audit-commissions-blockA.cjs
 *
 * Flags opcionales:
 *   LIMIT=50   → máximo de filas por sección (default 40)
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

const LIMIT = Number(process.env.LIMIT || 40);
const TOL = 0.01; // tolerancia 1% para "mal calculada"

const CANON = { MENSUAL: 68, TRIMESTRAL: 150, SEMESTRAL: 278, ANUAL: 500 };

const n = (v) => Number(v ?? 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;
const usd = (v) => `$${r2(v).toFixed(2)}`;
const normPeriod = (p) => {
  const k = String(p ?? 'MENSUAL').toUpperCase();
  return CANON[k] != null ? k : 'MENSUAL';
};

function hr(title) {
  console.log('\n' + '='.repeat(72));
  console.log(title);
  console.log('='.repeat(72));
}

async function loadCanonPrices() {
  // Lee precios canónicos reales del Setting (fallback a defaults 68/150/278/500)
  const keys = {
    MENSUAL: 'landing.plans.mensual.price',
    TRIMESTRAL: 'landing.plans.trimestral.price',
    SEMESTRAL: 'landing.plans.semestral.price',
    ANUAL: 'landing.plans.anual.price',
  };
  const rows = await prisma.setting.findMany({
    where: { key: { in: Object.values(keys) } },
  });
  const map = { ...CANON };
  for (const [k, key] of Object.entries(keys)) {
    const row = rows.find((x) => x.key === key);
    if (row && Number.isFinite(Number(row.value)) && Number(row.value) > 0) {
      map[k] = Number(row.value);
    }
  }
  return map;
}

async function main() {
  console.log('AUDITORÍA BLOQUE A — Comisiones / Hotmart (READ-ONLY)');
  console.log('Fecha:', new Date().toISOString());

  const canonPrices = await loadCanonPrices();
  console.log('\nPrecios canónicos vigentes (Setting):', canonPrices);

  // ---- Carga base ----
  const codes = await prisma.referralCode.findMany({
    select: {
      id: true, code: true, ownerName: true, role: true, commissionPercent: true,
      maxCommissionPercent: true, isActive: true, parentCodeId: true,
      parentEmbajadorCodeId: true,
    },
  });
  const codeById = new Map(codes.map((c) => [c.id, c]));

  const commissions = await prisma.commission.findMany({
    select: {
      id: true, referralUseId: true, recipientCodeId: true, amount: true,
      amountPaid: true, status: true, paymentStatus: true, periodKey: true,
      vendorCodeId: true, createdAt: true,
      referralUse: {
        select: {
          referralCodeId: true,
          tenant: {
            select: {
              id: true, brandName: true, status: true, planPeriodicity: true,
              subscriptionPriceUsd: true, deletedAt: true,
            },
          },
        },
      },
    },
  });

  console.log(`\nTotal codes: ${codes.length} | Total commissions: ${commissions.length}`);

  // ===================================================================
  // 1. COMISIONES MAL CALCULADAS (amount ≠ base × % esperado)
  // ===================================================================
  hr('1. COMISIONES MAL CALCULADAS (amount vs base × %)');
  console.log('Nota: no aplica excepciones por-tenant (CommissionException), así que');
  console.log('algunas filas marcadas pueden tener una excepción válida. Revisar caso a caso.\n');

  const SOCIO_PCT = 10, INDIRECT_PCT = 5;
  const mismatches = [];
  let skippedNoTenant = 0;
  for (const c of commissions) {
    if (c.status === 'REJECTED') continue;
    const t = c.referralUse?.tenant;
    if (!t) { skippedNoTenant++; continue; }
    const period = normPeriod(t.planPeriodicity);
    const base = n(t.subscriptionPriceUsd) > 0 ? n(t.subscriptionPriceUsd) : canonPrices[period];
    if (base <= 0) continue;

    const recip = c.recipientCodeId ? codeById.get(c.recipientCodeId) : null;
    const isDirect = c.recipientCodeId && c.recipientCodeId === c.referralUse.referralCodeId;
    const isIndirect = c.recipientCodeId && !isDirect && recip?.role === 'INFLUENCER';
    const isSocio = recip?.role === 'SOCIO';
    const isVendor = recip?.role === 'VENDOR';

    const impliedPct = r2((n(c.amount) / base) * 100);

    // % esperado
    let expectedPct = null;
    if (isSocio) expectedPct = SOCIO_PCT;
    else if (isIndirect) expectedPct = INDIRECT_PCT;
    else if (recip) expectedPct = n(recip.commissionPercent);
    // vendor: el embajador recibe (su% − vendor%); el vendor su% directo.
    // Para vendor row esperamos su propio %.

    if (expectedPct == null) continue;
    const expectedAmount = r2((base * expectedPct) / 100);
    const diff = Math.abs(n(c.amount) - expectedAmount);
    const rel = expectedAmount > 0 ? diff / expectedAmount : (n(c.amount) > 0 ? 1 : 0);
    if (rel > TOL && diff > 0.01) {
      mismatches.push({
        biz: t.brandName, who: recip?.ownerName || '(?)', role: recip?.role || '?',
        kind: isDirect ? 'directa' : isIndirect ? 'indirecta(5%)' : isSocio ? 'socio(10%)' : isVendor ? 'vendor' : 'otra',
        base, expectedPct, impliedPct, amount: n(c.amount), expectedAmount,
        status: c.status, id: c.id,
      });
    }
  }
  console.log(`Comisiones marcadas: ${mismatches.length} (sin tenant: ${skippedNoTenant})`);
  let totalDelta = 0;
  for (const m of mismatches) totalDelta += m.amount - m.expectedAmount;
  console.log(`Delta total (actual − esperado): ${usd(totalDelta)}\n`);
  mismatches
    .sort((a, b) => Math.abs(b.amount - b.expectedAmount) - Math.abs(a.amount - a.expectedAmount))
    .slice(0, LIMIT)
    .forEach((m) => {
      console.log(
        `  [${m.status}] ${m.biz} → ${m.who} (${m.role}/${m.kind}) | base ${usd(m.base)} ×${m.expectedPct}% ` +
        `esperado ${usd(m.expectedAmount)} vs actual ${usd(m.amount)} (implícito ${m.impliedPct}%) | ${m.id}`,
      );
    });

  // ===================================================================
  // 2. TENANTS CON subscriptionPriceUsd NULL O DESALINEADO (#18)
  // ===================================================================
  hr('2. TENANTS — subscriptionPriceUsd null o ≠ precio canónico (#18 facturación real)');
  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null },
    select: {
      id: true, brandName: true, status: true, planPeriodicity: true,
      subscriptionPriceUsd: true,
    },
    orderBy: { brandName: 'asc' },
  });
  const active = tenants.filter((t) => t.status === 'ACTIVE');
  const nullPrice = active.filter((t) => !(n(t.subscriptionPriceUsd) > 0));
  const misaligned = active.filter((t) => {
    const p = n(t.subscriptionPriceUsd);
    if (!(p > 0)) return false;
    return Math.abs(p - canonPrices[normPeriod(t.planPeriodicity)]) > 0.01;
  });
  console.log(`Tenants ACTIVE: ${active.length}`);
  console.log(`  · sin subscriptionPriceUsd (usan canónico → facturación aprox): ${nullPrice.length}`);
  console.log(`  · con precio real ≠ canónico (el caso $250 vs $278): ${misaligned.length}\n`);
  console.log('-- Sin precio real (top) --');
  nullPrice.slice(0, LIMIT).forEach((t) =>
    console.log(`  ${t.brandName} | ${normPeriod(t.planPeriodicity)} | canónico ${usd(canonPrices[normPeriod(t.planPeriodicity)])}`),
  );
  console.log('\n-- Precio real ≠ canónico --');
  misaligned.slice(0, LIMIT).forEach((t) =>
    console.log(`  ${t.brandName} | ${normPeriod(t.planPeriodicity)} | real ${usd(t.subscriptionPriceUsd)} vs canónico ${usd(canonPrices[normPeriod(t.planPeriodicity)])}`),
  );

  // ===================================================================
  // 3. VENDORS LEGACY POR ENCIMA DEL TOPE
  // ===================================================================
  hr('3. VENDORS por encima del tope (commissionPercent vendor > % del padre)');
  const vendors = codes.filter((c) => c.role === 'VENDOR');
  const overCap = [];
  for (const v of vendors) {
    const parent = v.parentEmbajadorCodeId ? codeById.get(v.parentEmbajadorCodeId) : null;
    if (!parent) {
      overCap.push({ v, parent: null, reason: 'sin padre' });
      continue;
    }
    const ownPct = n(v.commissionPercent);
    const parentPct = n(parent.commissionPercent);
    const cap = Math.min(parentPct, parent.maxCommissionPercent != null ? n(parent.maxCommissionPercent) : parentPct);
    if (ownPct > cap + 0.001) {
      overCap.push({ v, parent, ownPct, parentPct, cap });
    }
  }
  console.log(`Vendors totales: ${vendors.length} | por encima del tope: ${overCap.length}\n`);
  overCap.slice(0, LIMIT).forEach((o) => {
    if (!o.parent) {
      console.log(`  ⚠️  ${o.v.ownerName} (${o.v.code}) — ${o.reason}, comm ${o.v.commissionPercent}%`);
    } else {
      console.log(`  ⚠️  ${o.v.ownerName} (${o.v.code}) ${o.ownPct}% > tope ${o.cap}% [padre ${o.parent.ownerName} ${o.parentPct}%]`);
    }
  });

  // ===================================================================
  // 4. PAGOS PARCIALES QUE DESCUADRAN DASHBOARD vs REFERIDOS (#14/#37)
  // ===================================================================
  hr('4. PAGOS PARCIALES — descuadre Dashboard (amount−amountPaid) vs Referidos/Comisiones (amount)');
  const partialLive = commissions.filter(
    (c) => ['PENDING', 'APPROVED'].includes(c.status) && n(c.amountPaid) > 0,
  );
  let gap = 0;
  for (const c of partialLive) gap += n(c.amountPaid);
  console.log(`Comisiones PENDING/APPROVED con amountPaid > 0: ${partialLive.length}`);
  console.log(`Gap total entre superficies (Σ amountPaid sobre vivas): ${usd(gap)}`);
  console.log('→ Dashboard resta amountPaid; Referidos/Comisiones no. Ese gap es la diferencia visible.\n');
  partialLive.slice(0, LIMIT).forEach((c) => {
    const recip = c.recipientCodeId ? codeById.get(c.recipientCodeId) : null;
    console.log(`  [${c.status}] ${c.referralUse?.tenant?.brandName || '(?)'} → ${recip?.ownerName || '(?)'} | amount ${usd(c.amount)} pagado ${usd(c.amountPaid)} | ${c.id}`);
  });

  // ===================================================================
  // 5. DUPLICADOS POR CICLO
  // ===================================================================
  hr('5. DUPLICADOS por ciclo (referralUseId + recipientCodeId + periodKey)');
  const seen = new Map();
  const dups = [];
  for (const c of commissions) {
    if (c.status === 'REJECTED') continue;
    const key = `${c.referralUseId}|${c.recipientCodeId ?? 'null'}|${c.periodKey ?? 'null'}`;
    if (seen.has(key)) dups.push({ key, c, first: seen.get(key) });
    else seen.set(key, c);
  }
  console.log(`Grupos con duplicado (mismo use+recipient+periodo): ${dups.length}\n`);
  dups.slice(0, LIMIT).forEach((d) => {
    const recip = d.c.recipientCodeId ? codeById.get(d.c.recipientCodeId) : null;
    console.log(`  DUP ${d.c.referralUse?.tenant?.brandName || '(?)'} → ${recip?.ownerName || '(?)'} | periodo ${d.c.periodKey ?? 'null'} | ${usd(d.c.amount)} | ids ${d.first.id} & ${d.c.id}`);
  });
  if (dups.some((d) => d.c.periodKey == null)) {
    console.log('\n  ⚠️  Hay duplicados con periodKey null (filas legacy pre-UNIQUE) — la constraint no los protege.');
  }

  // ===================================================================
  // 6. COMISIONES VIVAS APUNTANDO A CODES INACTIVOS / TENANTS BORRADOS (#4/#7)
  // ===================================================================
  hr('6. COMISIONES VIVAS con code inactivo o tenant borrado (#4 cascada / #7 borrados)');
  const liveBad = [];
  for (const c of commissions) {
    if (!['PENDING', 'APPROVED'].includes(c.status)) continue;
    const recip = c.recipientCodeId ? codeById.get(c.recipientCodeId) : null;
    const t = c.referralUse?.tenant;
    const codeInactive = recip && recip.isActive === false;
    const tenantDeleted = t && t.deletedAt != null;
    if (codeInactive || tenantDeleted) {
      liveBad.push({ c, recip, t, codeInactive, tenantDeleted });
    }
  }
  console.log(`Comisiones PENDING/APPROVED problemáticas: ${liveBad.length}\n`);
  liveBad.slice(0, LIMIT).forEach((x) => {
    const tags = [x.codeInactive ? 'code-inactivo' : null, x.tenantDeleted ? 'tenant-borrado' : null].filter(Boolean).join('+');
    console.log(`  [${tags}] ${x.t?.brandName || '(?)'} → ${x.recip?.ownerName || '(?)'} | ${usd(x.c.amount)} ${x.c.status} | ${x.c.id}`);
  });

  // ===================================================================
  // 7. RECONCILIACIÓN DE TOTALES (3 superficies)
  // ===================================================================
  hr('7. RECONCILIACIÓN DE TOTALES — pending según cada superficie');
  const notRejected = commissions.filter((c) => c.status !== 'REJECTED');
  // Dashboard: Σ(amount) − Σ(amountPaid) sobre NO-rejected
  const dashAmount = notRejected.reduce((s, c) => s + n(c.amount), 0);
  const dashPaidField = notRejected.reduce((s, c) => s + n(c.amountPaid), 0);
  const dashboardPending = r2(Math.max(0, dashAmount - dashPaidField));
  // Referidos/Comisiones: Σ(amount) donde status PENDING|APPROVED
  const refPending = r2(
    commissions.filter((c) => ['PENDING', 'APPROVED'].includes(c.status)).reduce((s, c) => s + n(c.amount), 0),
  );
  // Pagadas
  const paidStatus = r2(commissions.filter((c) => c.status === 'PAID').reduce((s, c) => s + n(c.amount), 0));
  const approved = r2(commissions.filter((c) => c.status === 'APPROVED').reduce((s, c) => s + n(c.amount), 0));
  const pendingOnly = r2(commissions.filter((c) => c.status === 'PENDING').reduce((s, c) => s + n(c.amount), 0));
  const retained = r2(commissions.filter((c) => c.status === 'RETAINED').reduce((s, c) => s + n(c.amount), 0));
  const rejected = r2(commissions.filter((c) => c.status === 'REJECTED').reduce((s, c) => s + n(c.amount), 0));

  console.log(`PENDING (sólo):        ${usd(pendingOnly)}`);
  console.log(`APPROVED (disponible): ${usd(approved)}`);
  console.log(`RETAINED (retenida):   ${usd(retained)}`);
  console.log(`REJECTED (cancelada):  ${usd(rejected)}  (no entra en totales)`);
  console.log(`PAID (pagada):         ${usd(paidStatus)}`);
  console.log('-'.repeat(50));
  console.log(`Pending — Dashboard (amount−amountPaid, no-rejected): ${usd(dashboardPending)}`);
  console.log(`Pending — Referidos/Comisiones (Σ amount PENDING+APPROVED): ${usd(refPending)}`);
  console.log(`Σ amountPaid sobre filas vivas: ${usd(dashPaidField)}`);
  const recoGap = r2(dashboardPending - refPending);
  console.log(`GAP entre ambas definiciones: ${usd(recoGap)}`);
  console.log('\nNota: Dashboard incluye PAID en el pool no-rejected y resta amountPaid; las otras 2');
  console.log('superficies miran sólo PENDING+APPROVED por status. Esa es la causa raíz del descuadre (#14/#37).');

  console.log('\n\n✅ Auditoría completa (no se modificó ningún dato).');
}

main()
  .catch((e) => {
    console.error('ERROR:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
