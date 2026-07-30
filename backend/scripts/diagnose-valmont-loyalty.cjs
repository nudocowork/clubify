// READ-ONLY. Foco lealtad Valmont: tarjetas, sellos, premios, clientes/pases
// duplicados, pases huérfanos (customer sin pase / pase sin customer),
// legacyQrTokens, estados de pase, y coherencia stampsCount vs Stamp real.
//   railway run --service Postgres-Nq8w node .../backend/scripts/diagnose-valmont-loyalty.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const t = await prisma.tenant.findFirst({
    where: { slug: { contains: 'valmont', mode: 'insensitive' } },
    select: { id: true, brandName: true },
  });
  console.log(`Tenant: ${t.brandName} (${t.id})\n`);

  // ---- Tarjetas ----
  const cards = await prisma.card.findMany({
    where: { tenantId: t.id },
    select: { id: true, type: true, name: true, stampsRequired: true },
  });
  console.log(`Tarjetas (${cards.length}):`);
  for (const c of cards) console.log(`  · ${c.name} [${c.type}] sellos requeridos=${c.stampsRequired ?? 'null'} | ${c.id.slice(0, 8)}`);

  // ---- Clientes / duplicados ----
  const customers = await prisma.customer.findMany({
    where: { tenantId: t.id },
    select: { id: true, fullName: true, phone: true, email: true, createdAt: true },
  });
  console.log(`\nClientes: ${customers.length}`);
  const byPhone = {}, byName = {};
  for (const c of customers) {
    if (c.phone) (byPhone[c.phone] ??= []).push(c);
    const nk = (c.fullName || '').trim().toLowerCase();
    if (nk) (byName[nk] ??= []).push(c);
  }
  const dupPhone = Object.entries(byPhone).filter(([, v]) => v.length > 1);
  const dupName = Object.entries(byName).filter(([, v]) => v.length > 1);
  console.log(`  Duplicados por teléfono: ${dupPhone.length}`);
  dupPhone.slice(0, 15).forEach(([p, v]) => console.log(`    ⚠️ ${p}: ${v.map((x) => `${x.fullName}(${x.id.slice(0, 6)})`).join(' | ')}`));
  console.log(`  Mismo nombre (posible duplicado sin tel): ${dupName.length}`);
  dupName.slice(0, 10).forEach(([n, v]) => console.log(`    · ${n}: ${v.length}×`));

  // ---- Pases ----
  const passes = await prisma.pass.findMany({
    where: { tenantId: t.id },
    select: { id: true, customerId: true, cardId: true, status: true, stampsCount: true,
      qrToken: true, legacyQrTokens: true, serialNumber: true,
      _count: { select: { stamps: true, walletDevices: true } } },
  });
  const byStatus = {};
  let withLegacy = 0, stampMismatch = 0, mismatchExamples = [];
  const custWithPass = new Set();
  for (const p of passes) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    if (p.legacyQrTokens?.length) withLegacy++;
    if (p.customerId) custWithPass.add(p.customerId);
    // stampsCount del pase vs sellos reales registrados
    if (p.stampsCount !== p._count.stamps && mismatchExamples.length < 12) {
      stampMismatch++;
      mismatchExamples.push(`${p.serialNumber}: contador=${p.stampsCount} vs sellos=${p._count.stamps}`);
    } else if (p.stampsCount !== p._count.stamps) stampMismatch++;
  }
  console.log(`\nPases (${passes.length}): estados ${JSON.stringify(byStatus)}`);
  console.log(`  Con legacyQrTokens (ya rotados/fusionados): ${withLegacy}`);
  console.log(`  Con dispositivo registrado (push llega): ${passes.filter((p) => p._count.walletDevices > 0).length}`);

  // Clientes sin pase (no pueden recibir sellos en billetera)
  const noPass = customers.filter((c) => !custWithPass.has(c.id));
  console.log(`\n  Clientes SIN pase: ${noPass.length}`);
  noPass.slice(0, 15).forEach((c) => console.log(`    · ${c.fullName} ${c.phone || ''} (${c.id.slice(0, 6)})`));

  // stampsCount vs sellos reales — NOTA: puede diferir legítimamente si el
  // premio se canjeó (reset del contador). Solo alarmante si contador > sellos.
  console.log(`\n  Pases con stampsCount ≠ #Stamp: ${stampMismatch}`);
  mismatchExamples.forEach((m) => console.log(`    · ${m}`));

  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
