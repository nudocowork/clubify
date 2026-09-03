// SOLO LECTURA (DRY-RUN). No escribe nada. Muestra qué pasaría al aplicar la
// regla "comisión = override manual (subscriptionPriceUsd) o canónico del plan":
//   - Qué tenants tienen subscriptionPriceUsd auto-FX (cerca del canónico) que
//     se LIMPIARÍA (→ el crudo se mueve a lastPaymentAmountUsd, la base pasa a
//     canónico). Vs overrides manuales deliberados (lejos del canónico) que se
//     PRESERVAN.
//   - Qué comisiones PENDING/APPROVED cambiarían de monto (PAID nunca se toca).
//   railway run --service Postgres-Nq8w node scripts/dryrun-commission-canonical-fix.cjs
const { PrismaClient } = require('@prisma/client');
const round2 = (n) => Math.round(n * 100) / 100;
const CANON_DEFAULT = { mensual: 68, trimestral: 150, semestral: 278, anual: 500 };
// Banda para clasificar "auto-FX" (se limpia) vs "override manual" (se preserva).
const LO = 0.92, HI = 1.08;

function periodKeyOf(p) {
  const s = String(p || 'MENSUAL').toUpperCase();
  if (s.startsWith('TRIM')) return 'trimestral';
  if (s.startsWith('SEM')) return 'semestral';
  if (s.startsWith('AN')) return 'anual';
  return 'mensual';
}

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // Canónicos reales (Settings override o defaults 68/150/278/500).
  const canon = { ...CANON_DEFAULT };
  for (const k of Object.keys(canon)) {
    const row = await prisma.setting.findUnique({ where: { key: `landing.plans.${k}.price` } });
    if (row?.value && !isNaN(Number(row.value))) canon[k] = Number(row.value);
  }
  console.log('Canónicos usados:', canon, '\n');

  const tenants = await prisma.tenant.findMany({
    where: { subscriptionPriceUsd: { not: null } },
    select: { id: true, brandName: true, name: true, planPeriodicity: true, subscriptionPriceUsd: true },
  });

  let clearCount = 0, keepCount = 0, borderline = 0;
  let comChanged = 0, deltaTotal = 0;
  const clearTenantIds = [];
  const rowsForNamed = {};

  const lines = [];
  for (const t of tenants) {
    const pk = periodKeyOf(t.planPeriodicity);
    const cano = canon[pk];
    const sub = Number(t.subscriptionPriceUsd);
    const ratio = cano ? sub / cano : 0;
    const isFxAuto = ratio >= LO && ratio <= HI;
    const isBorderline = !isFxAuto && ratio >= 0.80 && ratio < LO; // cerca pero fuera
    if (isFxAuto) { clearCount++; clearTenantIds.push(t.id); }
    else { keepCount++; if (isBorderline) borderline++; }

    const verdict = isFxAuto
      ? `LIMPIAR → base ${cano}`
      : `PRESERVAR (override manual)${isBorderline ? ' ⚠ borderline, revisar' : ''}`;
    const nm = t.brandName || t.name;
    lines.push(`  ${nm.padEnd(28).slice(0,28)} ${pk.padEnd(11)} sub=${sub.toFixed(2).padStart(8)} canon=${String(cano).padStart(4)} ratio=${ratio.toFixed(3)}  → ${verdict}`);
    const low = nm.toLowerCase();
    if (low.includes('protein')) rowsForNamed.protein = { t, cano, sub, isFxAuto };
    if (low.includes('tubi')) rowsForNamed.tubinez = { t, cano, sub, isFxAuto };
    if (low.includes('ponke')) rowsForNamed.dponke = { t, cano, sub, isFxAuto };
  }

  console.log('=== TENANTS con subscriptionPriceUsd (override actual) ===');
  lines.sort().forEach((l) => console.log(l));
  console.log(`\nResumen tenants: LIMPIAR(auto-FX)=${clearCount}  PRESERVAR(manual)=${keepCount} (de ellos borderline=${borderline})\n`);

  // Comisiones PENDING/APPROVED de los tenants a LIMPIAR → recalculo a canónico.
  console.log('=== COMISIONES PENDING/APPROVED que cambiarían (tenants a limpiar) ===');
  for (const t of tenants.filter((x) => clearTenantIds.includes(x.id))) {
    const pk = periodKeyOf(t.planPeriodicity);
    const cano = canon[pk];
    const sub = Number(t.subscriptionPriceUsd);
    const coms = await prisma.commission.findMany({
      where: {
        status: { in: ['PENDING', 'APPROVED'] },
        referralUse: { tenantId: t.id },
      },
      select: {
        id: true, amount: true, status: true, appliedPercent: true, baseAmountUsd: true,
        recipientCode: { select: { code: true, commissionPercent: true } },
      },
    });
    if (coms.length === 0) continue;
    for (const c of coms) {
      const cur = Number(c.amount);
      const base = c.baseAmountUsd != null ? Number(c.baseAmountUsd) : sub;
      // % LIMPIO: snapshot appliedPercent → % del afiliado (recipientCode) →
      // derivado del monto (último recurso). Derivar del monto FX mete error de
      // 1 centavo (10.0009% en vez de 10%), por eso va último.
      let pct = c.appliedPercent != null ? Number(c.appliedPercent)
        : c.recipientCode?.commissionPercent != null ? Number(c.recipientCode.commissionPercent)
        : (base > 0 ? (cur / base) * 100 : 0);
      const next = round2((cano * pct) / 100);
      const delta = round2(next - cur);
      if (Math.abs(delta) >= 0.01) {
        comChanged++; deltaTotal = round2(deltaTotal + delta);
        console.log(`  ${(t.brandName||t.name).slice(0,24).padEnd(24)} ${c.status.padEnd(9)} pct=${pct.toFixed(1).padStart(5)} base ${base.toFixed(2)}→${cano}  monto ${cur.toFixed(2)} → ${next.toFixed(2)}  (Δ ${delta>=0?'+':''}${delta.toFixed(2)})`);
      }
    }
  }
  console.log(`\nResumen comisiones: cambian=${comChanged}  ΔtotalUSD=${deltaTotal>=0?'+':''}${deltaTotal.toFixed(2)}  (PAID nunca se toca)\n`);

  // Validación de los 3 casos oficiales.
  console.log('=== VALIDACIÓN casos oficiales ===');
  const showNamed = async (key, label, expectSub) => {
    const r = rowsForNamed[key];
    if (!r) { console.log(`  ${label}: (no encontrado con subscriptionPriceUsd — probablemente null = ya usa canónico)`); return; }
    const coms = await prisma.commission.findMany({
      where: { status: { in: ['PENDING', 'APPROVED'] }, referralUse: { tenantId: r.t.id } },
      select: { amount: true, appliedPercent: true, baseAmountUsd: true, status: true, recipientCode: { select: { commissionPercent: true } } },
    });
    const detail = coms.map((c) => {
      const cur = Number(c.amount);
      const base = c.baseAmountUsd != null ? Number(c.baseAmountUsd) : r.sub;
      const pct = c.appliedPercent != null ? Number(c.appliedPercent)
        : c.recipientCode?.commissionPercent != null ? Number(c.recipientCode.commissionPercent)
        : (base>0 ? cur/base*100 : 0);
      const next = round2((r.cano * pct)/100);
      return `${cur.toFixed(2)}→${next.toFixed(2)}`;
    }).join(', ');
    console.log(`  ${label}: sub=${r.sub.toFixed(2)} canon=${r.cano} ${r.isFxAuto?'LIMPIAR':'PRESERVAR'} | comisiones: ${detail || '(sin pendientes)'}`);
  };
  await showNamed('protein', "Protein Station (espera 7.43→7.50)");
  await showNamed('tubinez', "Tubiñez (debe quedar 7.50, sin cambio)");
  await showNamed('dponke', "D'Ponke (espera 49.52→50.00)");

  await prisma.$disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
