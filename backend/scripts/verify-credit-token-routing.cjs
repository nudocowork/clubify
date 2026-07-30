// VERIFICACIÓN (dryRun, SOLO-LECTURA) del ruteo por token del Modelo B.
// Instancia el HotmartService REAL (dist) con el Prisma de prod y llama directo
// a tryHandleCreditPurchase(payload, true). En dryRun solo usa this.prisma
// (resuelve marca+cantidad y retorna sin escribir). Prueba el CÓDIGO real.
//   railway run --service Postgres-Nq8w node scripts/verify-credit-token-routing.cjs
const { PrismaClient } = require('@prisma/client');
const { HotmartService } = require('../dist/billing/hotmart.service.js');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  // dryRun de tryHandleCreditPurchase solo toca this.prisma → deps null OK.
  const svc = new HotmartService(prisma, null, null, null, null, null, null, null, null, null);

  const sellea = await prisma.whiteLabel.findFirst({
    where: { slug: 'sellea' }, select: { id: true, name: true },
  });
  if (!sellea) { console.error('No existe Sellea'); process.exit(1); }
  console.log('Sellea id =', sellea.id, '\n');

  const links = await prisma.hotmartCreditLink.findMany({
    where: { isActive: true, hotmartProductId: { not: null } },
    select: { credits: true, hotmartProductId: true, hotmartOfferCode: true },
  });

  const build = (link, token) => ({
    id: `sim-${Math.round(performance.now())}-${Math.random().toString(36).slice(2)}`,
    event: 'PURCHASE_APPROVED',
    data: {
      buyer: { email: 'quien-sea@example.com' },
      purchase: {
        transaction: `VERIFY-${Math.random().toString(36).slice(2).toUpperCase()}`,
        status: 'APPROVED',
        approved_date: 1,
        offer: link.hotmartOfferCode ? { code: link.hotmartOfferCode } : undefined,
        tracking: token ? { source: token } : undefined,
      },
      product: { id: Number(link.hotmartProductId) },
    },
  });

  for (const pack of [1, 10, 20]) {
    const link = links.find((l) => l.credits === pack);
    if (!link) { console.log(`Pack ${pack}: (sin link activo)`); continue; }
    console.log(`\n═══ Pack ${pack} créditos (product=${link.hotmartProductId} offer=${link.hotmartOfferCode}) ═══`);
    const withTok = await svc.tryHandleCreditPurchase(build(link, `wl_${sellea.id}`), true);
    console.log(`  con token wl_<sellea> → ${withTok}`);
    console.log(`     ${/whiteLabelId=5c13ca30|whiteLabelId=${sellea.id}/.test(withTok) || withTok.includes(sellea.id) ? '✅ acredita a SELLEA' : '❌ NO fue a Sellea'}`);
    const noTok = await svc.tryHandleCreditPurchase(build(link, null), true);
    console.log(`  SIN token           → ${noTok}`);
    console.log(`     ${noTok.includes('UNASSIGNED') ? '✅ UNASSIGNED (no lo absorbe Clubify)' : '❌ debería ser UNASSIGNED'}`);
    const badTok = await svc.tryHandleCreditPurchase(build(link, 'wl_00000000-0000-0000-0000-000000000000'), true);
    console.log(`  token inexistente   → ${badTok}`);
    console.log(`     ${badTok.includes('UNASSIGNED') ? '✅ UNASSIGNED' : '❌ debería ser UNASSIGNED'}`);
  }

  await prisma.$disconnect();
  console.log('\n(dryRun — no se escribió ni acreditó nada)');
})().catch((e) => { console.error(e); process.exit(1); });
