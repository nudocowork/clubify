/* READ-ONLY. Fase 0 auditoría panel de facturación (/admin dashboard).
 * Solo SELECT/aggregate. NO escribe nada. NO toca comisiones (solo lee).
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const r2 = (n) => Math.round(n * 100) / 100;
const ym = (d) => {
  if (!d) return 'null';
  const x = new Date(d);
  return x.getUTCFullYear() + '-' + String(x.getUTCMonth() + 1).padStart(2, '0');
};
function tally(arr, keyFn, amtFn) {
  const m = {};
  for (const it of arr) {
    const k = keyFn(it);
    if (!m[k]) m[k] = { n: 0, amt: 0 };
    m[k].n += 1;
    m[k].amt += amtFn ? Number(amtFn(it) || 0) : 0;
  }
  return m;
}
function printTally(title, m) {
  console.log(`\n${title}`);
  Object.keys(m).sort().forEach((k) => {
    console.log(`  ${k}: ${m[k].n} reg` + (m[k].amt ? ` · $${r2(m[k].amt)}` : ''));
  });
}

(async () => {
  console.log('======== DIAGNÓSTICO PANEL FACTURACIÓN (READ-ONLY) ========');

  // 0) Estado de tenants (activos, no soft-deleted)
  const byStatus = await prisma.tenant.groupBy({
    by: ['status'], _count: { _all: true }, where: { deletedAt: null },
  });
  console.log('\n[0] Tenants por status (deletedAt null):');
  byStatus.forEach((s) => console.log(`  ${s.status}: ${s._count._all}`));

  // 1) lastChargeAt presente vs null en ACTIVE (población ~est / faltante)
  const activeTotal = await prisma.tenant.count({ where: { status: 'ACTIVE', deletedAt: null } });
  const activeNoCharge = await prisma.tenant.count({ where: { status: 'ACTIVE', deletedAt: null, lastChargeAt: null } });
  const activeWithCharge = activeTotal - activeNoCharge;
  console.log(`\n[1] ACTIVE total=${activeTotal} · con lastChargeAt=${activeWithCharge} · SIN lastChargeAt (se estiman ~est)=${activeNoCharge}`);

  // 2) Distribución de Tenant.lastChargeAt por mes (todos los que tienen)
  const charged = await prisma.tenant.findMany({
    where: { lastChargeAt: { not: null } },
    select: { lastChargeAt: true, planPeriodicity: true, subscriptionPriceUsd: true, status: true },
  });
  printTally(`[2] Tenant.lastChargeAt por mes (n=${charged.length} tenants con cobro real):`,
    tally(charged, (t) => ym(t.lastChargeAt), (t) => t.subscriptionPriceUsd));

  // 3) Commission.businessDate por mes (eventos de cobro REALES, solo referidos, no-rejected)
  const comms = await prisma.commission.findMany({
    where: { status: { not: 'REJECTED' } },
    select: {
      id: true, amount: true, businessDate: true, createdAt: true, status: true, businessGroupId: true,
      referralUse: { select: { tenant: { select: { id: true, brandName: true, lastChargeAt: true, status: true } } } },
    },
  });
  printTally(`[3] Commission.businessDate(??createdAt) por mes (n=${comms.length} comisiones no-rejected = eventos de cobro reales de referidos):`,
    tally(comms, (c) => ym(c.businessDate || c.createdAt), (c) => c.amount));

  // 3b) DISCRIMINANTE evidencia B: ¿hay comisiones (=cobros) ene-jun 2026 cuyo tenant
  //     tiene lastChargeAt en jul+ (o null)? => prueba que lastChargeAt se sobrescribe.
  let janJunCharges = 0, janJunTenantMovedForward = 0;
  for (const c of comms) {
    const m = ym(c.businessDate || c.createdAt);
    if (m >= '2026-01' && m <= '2026-06') {
      janJunCharges++;
      const lc = c.referralUse?.tenant?.lastChargeAt;
      const lcm = ym(lc);
      if (!lc || lcm > '2026-06') janJunTenantMovedForward++;
    }
  }
  console.log(`\n[3b] DISCRIMINANTE: cobros (comisiones) con fecha ene–jun 2026 = ${janJunCharges}. De esos, tenants cuyo lastChargeAt ES POSTERIOR a junio o null (=cobro viejo ya no visible en el panel) = ${janJunTenantMovedForward}`);

  // 4) Bug 2: comisiones no-rejected cuyo tenant NO tiene lastChargeAt (cobro ocurrió, panel no lo ve)
  const commsNoCharge = comms.filter((c) => c.referralUse?.tenant && !c.referralUse.tenant.lastChargeAt);
  console.log(`\n[4] Bug2 — comisiones no-rejected cuyo tenant tiene lastChargeAt NULL = ${commsNoCharge.length} (el cobro ocurrió pero el panel no lo cuenta). Ejemplos:`);
  const seen = new Set();
  for (const c of commsNoCharge) {
    const t = c.referralUse.tenant;
    if (seen.has(t.id)) continue; seen.add(t.id);
    console.log(`   - ${t.brandName} [${t.status}] · comisión $${r2(Number(c.amount))} · businessDate ${c.businessDate ? new Date(c.businessDate).toISOString().slice(0,10) : '—'}`);
    if (seen.size >= 15) break;
  }
  console.log(`   (tenants distintos afectados: ${seen.size}${commsNoCharge.length>seen.size?'+':''})`);

  // 5) Reconciliación pedida en el doc (Bug 2, punto 2) — conteos totales read-only
  const activeReferredNoCharge = seen.size;
  const tenantsMultiCharge = {}; // tenants con >1 comisión (=renovaciones capturadas por comisiones)
  for (const c of comms) {
    const t = c.referralUse?.tenant; if (!t) continue;
    tenantsMultiCharge[t.id] = (tenantsMultiCharge[t.id] || 0) + 1;
  }
  const renovCaptadasEnComisiones = Object.values(tenantsMultiCharge).filter((n) => n > 1).length;
  console.log(`\n[5] Reconciliación (read-only):`);
  console.log(`   - tenants ACTIVE sin ningún cobro registrado (lastChargeAt null): ${activeNoCharge}`);
  console.log(`   - comisiones (cobros) sin pago visible en el panel (tenant.lastChargeAt null): ${commsNoCharge.length} en ${activeReferredNoCharge} tenants`);
  console.log(`   - tenants (referidos) con MÁS de un cobro capturado en comisiones (=renovaciones): ${renovCaptadasEnComisiones} → el panel solo ve el ÚLTIMO por tenant`);

  // 6) Bug 5: Grupo Mistika
  const groups = await prisma.businessGroup.findMany({
    where: { name: { contains: 'Mistika', mode: 'insensitive' } },
    select: { id: true, name: true, status: true, priceUsd: true, planPeriodicity: true, lastChargeAt: true, deletedAt: true,
      tenants: { select: { brandName: true, status: true, lastChargeAt: true } } },
  });
  console.log(`\n[6] Bug5 — Grupo(s) "Mistika":`);
  for (const g of groups) {
    console.log(`   Grupo ${g.name} [${g.status}] priceUsd=${g.priceUsd} ${g.planPeriodicity} · lastChargeAt=${g.lastChargeAt ? new Date(g.lastChargeAt).toISOString().slice(0,10) : 'null'} · deletedAt=${g.deletedAt || 'null'}`);
    g.tenants.forEach((t) => console.log(`      · ${t.brandName} [${t.status}] lastChargeAt=${t.lastChargeAt ? new Date(t.lastChargeAt).toISOString().slice(0,10) : 'null'}`));
  }

  // 7) Casos puntuales: las 9 filas ~est del doc + Veterinaria Morán
  const names = ['Dinorolls','Hotel plaza','Cucuruccio','Limorada','Inoxalum','Arepas Sabrositas','Chipichape','La Gloriosa','Fusion sushi','Mor'];
  console.log(`\n[7] Casos del doc (status · lastChargeAt · currentPeriodEnd · subPriceUsd · ¿tiene comisión?):`);
  for (const nm of names) {
    const ts = await prisma.tenant.findMany({
      where: { brandName: { contains: nm, mode: 'insensitive' }, deletedAt: null },
      select: { id: true, brandName: true, status: true, lastChargeAt: true, currentPeriodEnd: true, subscriptionPriceUsd: true, planPeriodicity: true },
    });
    for (const t of ts) {
      const hasComm = comms.some((c) => c.referralUse?.tenant?.id === t.id);
      console.log(`   - ${t.brandName} [${t.status}] ${t.planPeriodicity} · lastChargeAt=${t.lastChargeAt ? new Date(t.lastChargeAt).toISOString().slice(0,10) : 'NULL'} · cpe=${t.currentPeriodEnd ? new Date(t.currentPeriodEnd).toISOString().slice(0,10) : 'null'} · $${t.subscriptionPriceUsd ?? '—'} · comisión=${hasComm ? 'SÍ' : 'no'}`);
    }
  }

  console.log('\n======== FIN (no se escribió nada) ========');
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
