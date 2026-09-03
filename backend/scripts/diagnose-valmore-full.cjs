// READ-ONLY. Diagnóstico integral del negocio Valmore/Valmont: identidad,
// facturación/precio, comisiones + atribución, pases wallet (QR/refresh),
// pedidos, reservas y sellos. Busca inconsistencias que causen quejas.
//   railway run --service Postgres-Nq8w node /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/diagnose-valmore-full.cjs
const { PrismaClient } = require('@prisma/client');

const CANON = { MENSUAL: 68, TRIMESTRAL: 150, SEMESTRAL: 278, ANUAL: 500 };

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const now = new Date();

  const tenants = await prisma.tenant.findMany({
    where: { OR: [
      { brandName: { contains: 'valmo', mode: 'insensitive' } },
      { slug: { contains: 'valmo', mode: 'insensitive' } },
    ] },
    select: {
      id: true, brandName: true, slug: true, status: true,
      planPeriodicity: true, subscriptionPriceUsd: true, currency: true,
      country: true, whiteLabelId: true, trialStartedAt: true, trialEndsAt: true,
      currentPeriodEnd: true, lastChargeAt: true, createdAt: true,
    },
  });
  if (!tenants.length) { console.log('✗ Ningún tenant "valmo*" encontrado'); process.exit(1); }

  for (const t of tenants) {
    console.log(`\n████████ ${t.brandName} | /${t.slug} | ${t.id} | ${t.status}`);
    const wl = t.whiteLabelId
      ? await prisma.whiteLabel.findUnique({ where: { id: t.whiteLabelId }, select: { name: true, slug: true } })
      : null;
    console.log(`  Marca: ${wl ? `${wl.name} (${wl.slug})` : 'Clubify (null)'}`);
    console.log(`  Plan: ${t.planPeriodicity || '—'} | precio guardado: $${t.subscriptionPriceUsd ?? 'null'} | canónico: $${CANON[t.planPeriodicity] ?? '?'} | ${t.currency}/${t.country}`);
    console.log(`  Fechas: creado ${d(t.createdAt)} | trial ${d(t.trialStartedAt)}→${d(t.trialEndsAt)} | últ.cobro ${d(t.lastChargeAt)} | próx.cobro ${d(t.currentPeriodEnd)}`);

    // ---- Consistencia de facturación ----
    const warns = [];
    if (t.subscriptionPriceUsd == null) warns.push('precio NULL → usa canónico; verifica que sea el pactado');
    else if (CANON[t.planPeriodicity] && Number(t.subscriptionPriceUsd) !== CANON[t.planPeriodicity])
      warns.push(`precio $${t.subscriptionPriceUsd} ≠ canónico $${CANON[t.planPeriodicity]} (¿pactado o error de Hotmart?)`);
    if (t.status === 'ACTIVE' && !t.lastChargeAt) warns.push('ACTIVE sin lastChargeAt → no aparece en facturado real');
    if (t.status === 'ACTIVE' && t.currentPeriodEnd && t.currentPeriodEnd < now) warns.push(`ACTIVE pero currentPeriodEnd VENCIDO (${d(t.currentPeriodEnd)}) → mora`);
    if (t.currentPeriodEnd && t.lastChargeAt && t.currentPeriodEnd < t.lastChargeAt) warns.push('próx.cobro < últ.cobro (fechas invertidas)');

    // ---- Comisiones + atribución ----
    const uses = await prisma.referralUse.findMany({
      where: { tenantId: t.id },
      select: { id: true, status: true, createdAt: true,
        referralCode: { select: { code: true, role: true, commissionPercent: true, ownerName: true } } },
    });
    console.log(`\n  Atribución (${uses.length} referralUse):`);
    for (const u of uses) console.log(`    · ${u.referralCode?.code} [${u.referralCode?.role}] ${u.referralCode?.ownerName || ''} ${u.referralCode?.commissionPercent}% | use ${u.status} | ${d(u.createdAt)}`);
    if (uses.length > 1) warns.push(`${uses.length} atribuciones → riesgo de comisión duplicada/errónea (revisar cadena)`);

    const comms = await prisma.commission.findMany({
      where: { referralUse: { tenantId: t.id } },
      select: { id: true, amount: true, status: true, baseAmountUsd: true, appliedPercent: true,
        availableAt: true, paidAt: true, createdAt: true, paymentStatus: true, amountPaid: true,
        recipientCode: { select: { code: true, role: true, commissionPercent: true } } },
      orderBy: { createdAt: 'desc' },
    });
    console.log(`\n  Comisiones (${comms.length}):`);
    let totalComm = 0;
    for (const c of comms) {
      totalComm += Number(c.amount);
      const eff = c.availableAt ?? new Date(new Date(c.createdAt).getTime() + 15 * 86400000);
      const unlocked = eff <= now;
      const pct = Number(c.appliedPercent ?? c.recipientCode?.commissionPercent ?? 0);
      const base = Number(c.baseAmountUsd ?? 0);
      const expect = Math.round(base * pct) / 100;
      const mismatch = base > 0 && Math.abs(expect - Number(c.amount)) > 0.01;
      console.log(`    · $${c.amount} ${c.status}/${c.paymentStatus} | ${c.recipientCode?.code || '∅'} [${c.recipientCode?.role || '?'}] ${pct}%×$${base}${mismatch ? ` ⚠️ esperado $${expect}` : ''} | desbloq ${d(eff)} ${unlocked ? '✅' : '⏳'} | ${d(c.createdAt)}`);
      if (mismatch) warns.push(`comisión ${c.id.slice(0, 8)}: $${c.amount} ≠ ${pct}%×$${base}=$${expect}`);
      if (!c.availableAt) warns.push(`comisión ${c.id.slice(0, 8)} sin availableAt (usa fallback createdAt+15d)`);
    }
    // ¿Cobros recientes sin comisión generada?
    console.log(`  Total comisiones generadas: $${totalComm.toFixed(2)}`);

    // ---- Pases wallet ----
    const passes = await prisma.pass.findMany({
      where: { tenantId: t.id },
      select: { id: true, serialNumber: true, qrToken: true, status: true,
        walletPlatform: true, googleObjectId: true, customerId: true,
        legacyQrTokens: true, _count: { select: { walletDevices: true } } },
    });
    const fmt = (q) => !q ? 'NULL' : q === 'placeholder' ? 'placeholder' : q.startsWith('QR-') ? 'QR-corto' : q.split('.').length === 3 ? `JWT-largo(${q.length})` : `otro(${q.length})`;
    const dist = {}; let badTok = 0, googNoObj = 0, noCust = 0;
    for (const p of passes) {
      const k = fmt(p.qrToken); dist[k] = (dist[k] || 0) + 1;
      if (k.startsWith('JWT') || k === 'NULL' || k === 'placeholder') badTok++;
      if (p.walletPlatform === 'GOOGLE' && !p.googleObjectId) googNoObj++;
      if (!p.customerId) noCust++;
    }
    console.log(`\n  Pases (${passes.length}): ${JSON.stringify(dist)}`);
    if (badTok) warns.push(`${badTok} pases con qrToken inescaneable (JWT/NULL/placeholder) → cámara no lee`);
    if (googNoObj) warns.push(`${googNoObj} pases Google sin googleObjectId → refresh no patchea barcode`);
    if (noCust) warns.push(`${noCust} pases sin customerId → push de saludo cruzado`);

    // ---- Pedidos ----
    const orders = await prisma.order.groupBy({ by: ['status'], where: { tenantId: t.id }, _count: true });
    const totalOrders = orders.reduce((s, o) => s + o._count, 0);
    console.log(`\n  Pedidos (${totalOrders}): ${orders.map((o) => `${o.status}=${o._count}`).join(', ') || '—'}`);

    // ---- Reservas ----
    const resv = await prisma.reservation.groupBy({ by: ['status'], where: { tenantId: t.id }, _count: true });
    const totalResv = resv.reduce((s, r) => s + r._count, 0);
    console.log(`  Reservas (${totalResv}): ${resv.map((r) => `${r.status}=${r._count}`).join(', ') || '—'}`);

    // ---- Sellos ----
    const stamps = await prisma.stamp.count({ where: { tenantId: t.id } });
    const stampsNoOrder = await prisma.stamp.count({ where: { tenantId: t.id, orderId: null } });
    console.log(`  Sellos: ${stamps} (sin orderId: ${stampsNoOrder})`);

    // ---- Resumen ----
    console.log(`\n  ${warns.length ? '⚠️  HALLAZGOS:' : '✅ Sin inconsistencias evidentes'}`);
    warns.forEach((w) => console.log(`     • ${w}`));
  }

  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

function d(x) { return x ? new Date(x).toISOString().slice(0, 10) : '—'; }
