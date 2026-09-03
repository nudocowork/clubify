// READ-ONLY: por qué SELLEA (marca blanca) "usó un crédito y no se descontó".
const { PrismaClient } = require('@prisma/client');
const day = (d) => d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—';
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });

  const wl = await p.whiteLabel.findFirst({
    where: { OR: [{ name: { contains: 'sellea', mode: 'insensitive' } }, { slug: { contains: 'sellea', mode: 'insensitive' } }] },
    select: { id: true, name: true, slug: true, creditsAvailable: true, creditsCommitted: true, creditsUsed: true, creditsUnlimited: true, lowCreditsNotifiedAt: true },
  });
  if (!wl) { console.log('No existe WhiteLabel SELLEA'); await p.$disconnect(); return; }
  console.log('\n════ MARCA BLANCA ════');
  console.log(JSON.stringify(wl, null, 2));
  console.log(`  ⚠ creditsUnlimited=${wl.creditsUnlimited}  slug=${wl.slug}  → ${wl.creditsUnlimited || wl.slug === 'clubify' ? 'NO se descuenta crédito (por diseño)' : 'SÍ debería descontar'}`);

  const tenants = await p.tenant.findMany({
    where: { whiteLabelId: wl.id },
    select: { id: true, brandName: true, status: true, businessType: true, createdAt: true, purchasedAt: true, currentPeriodEnd: true },
    orderBy: { createdAt: 'desc' }, take: 20,
  });
  console.log(`\n════ NEGOCIOS de SELLEA (${tenants.length}) ════`);
  tenants.forEach((t) => console.log(`  ${day(t.createdAt)} ${(t.brandName||'—').slice(0,24).padEnd(24)} ${String(t.status).padEnd(9)} tipo=${t.businessType ?? '—'} compra=${day(t.purchasedAt)} vence=${day(t.currentPeriodEnd)}  id=${t.id.slice(0,8)}`));

  const txs = await p.creditTransaction.findMany({
    where: { whiteLabelId: wl.id }, orderBy: { createdAt: 'desc' }, take: 25,
    select: { type: true, amount: true, tenantId: true, note: true, createdAt: true, refundedAt: true },
  });
  console.log(`\n════ MOVIMIENTOS DE CRÉDITO (${txs.length}) ════`);
  let net = 0;
  txs.forEach((x) => { net += Number(x.amount); console.log(`  ${day(x.createdAt)} ${String(x.type).padEnd(10)} ${String(x.amount).padStart(7)} tenant=${x.tenantId ? x.tenantId.slice(0,8) : '—'} ${x.refundedAt ? '[REEMBOLSADO]' : ''} ${(x.note||'').slice(0,40)}`); });

  // Cross-check: negocios activos SIN movimiento CONSUME asociado.
  console.log(`\n════ CROSS-CHECK: negocios ACTIVE sin CONSUME ════`);
  const consumedTenantIds = new Set(txs.filter((x) => x.type === 'CONSUME' && !x.refundedAt).map((x) => x.tenantId));
  const activeNoConsume = tenants.filter((t) => t.status === 'ACTIVE' && !consumedTenantIds.has(t.id));
  if (!activeNoConsume.length) console.log('  (todos los ACTIVE tienen CONSUME ✓ — o no hay ACTIVE)');
  activeNoConsume.forEach((t) => console.log(`  ⚠ ${t.brandName} (${t.status}, compra=${day(t.purchasedAt)}) NO tiene CONSUME asociado`));

  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
