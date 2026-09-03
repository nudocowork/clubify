// DIAGNÓSTICO SOLO-LECTURA (no escribe nada): ¿Sellea (y las marcas) tienen sus
// links Hotmart de créditos configurados (productId + offerCode) para que la
// acreditación automática funcione? Lista también compras recientes/pendientes.
//   railway run --service Postgres-Nq8w node scripts/check-sellea-hotmart-config.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const line = '─'.repeat(70);

  // 1) Todas las marcas + saldo + dominio
  const wls = await prisma.whiteLabel.findMany({
    select: {
      id: true, slug: true, name: true, domain: true, appDomain: true,
      creditsAvailable: true, creditsUnlimited: true, status: true,
    },
    orderBy: { name: 'asc' },
  });
  console.log('\n' + line + '\nMARCAS BLANCAS (' + wls.length + ')\n' + line);
  for (const w of wls) {
    console.log(
      `• ${w.name} (slug=${w.slug}) status=${w.status} · créditos=${w.creditsUnlimited ? 'ILIMITADO' : w.creditsAvailable} · dominio=${w.domain || '—'} / app=${w.appDomain || '—'}`,
    );
  }

  // 2) Links Hotmart de crédito por marca
  const links = await prisma.hotmartCreditLink.findMany({
    select: {
      id: true, credits: true, label: true, price: true, currency: true,
      hotmartProductId: true, hotmartOfferCode: true, isActive: true,
      whiteLabelId: true, url: true,
    },
    orderBy: [{ whiteLabelId: 'asc' }, { credits: 'asc' }],
  });
  const nameById = Object.fromEntries(wls.map((w) => [w.id, w.name]));
  console.log('\n' + line + '\nLINKS HOTMART DE CRÉDITO (' + links.length + ')\n' + line);
  if (!links.length) console.log('⚠️  NO hay ningún HotmartCreditLink configurado.');
  for (const l of links) {
    const owner = l.whiteLabelId ? (nameById[l.whiteLabelId] || l.whiteLabelId) : '⚠️ SIN MARCA (legacy/global)';
    const ok = l.hotmartProductId && l.hotmartOfferCode ? '✅' : '⚠️ FALTA product/offer';
    console.log(
      `• [${owner}] ${l.credits} créditos ${ok} · productId=${l.hotmartProductId || '—'} · offerCode=${l.hotmartOfferCode || '—'} · activo=${l.isActive} · precio=${l.price ?? '—'}${l.currency || ''} · url=${l.url ? 'sí' : '—'}`,
    );
  }

  // 3) Foco Sellea
  const sellea = wls.find((w) => /sellea/i.test(w.name) || /sellea/i.test(w.slug));
  console.log('\n' + line + '\nFOCO: SELLEA\n' + line);
  if (!sellea) {
    console.log('⚠️  No encontré una marca que matchee "sellea".');
  } else {
    const sLinks = links.filter((l) => l.whiteLabelId === sellea.id);
    console.log(`Sellea id=${sellea.id} · créditos=${sellea.creditsUnlimited ? 'ILIMITADO' : sellea.creditsAvailable}`);
    console.log(`Links propios de Sellea: ${sLinks.length}`);
    for (const l of sLinks) {
      console.log(`   - ${l.credits}cr · productId=${l.hotmartProductId || '❌'} · offerCode=${l.hotmartOfferCode || '❌'} · activo=${l.isActive}`);
    }
    const packs = [1, 10, 20];
    for (const p of packs) {
      const has = sLinks.find((l) => l.credits === p && l.hotmartProductId && l.hotmartOfferCode && l.isActive);
      console.log(`   Pack ${p}cr configurado y activo: ${has ? '✅ SÍ' : '❌ NO → sus compras caerán a PENDIENTES'}`);
    }
    // Compras recientes de Sellea
    const purchases = await prisma.hotmartCreditPurchase.findMany({
      where: { whiteLabelId: sellea.id },
      select: { transactionId: true, credits: true, status: true, buyerEmail: true, createdAt: true },
      orderBy: { createdAt: 'desc' }, take: 10,
    });
    console.log(`\nCompras Hotmart registradas para Sellea: ${purchases.length}`);
    for (const p of purchases) {
      console.log(`   - ${p.status} · ${p.credits}cr · tx=${p.transactionId} · ${p.buyerEmail || '—'} · ${p.createdAt.toISOString().slice(0, 10)}`);
    }
  }

  // 4) Compras SIN asignar (globales)
  const unassigned = await prisma.hotmartCreditPurchase.findMany({
    where: { status: 'UNASSIGNED' },
    select: { transactionId: true, credits: true, buyerEmail: true, createdAt: true },
    orderBy: { createdAt: 'desc' }, take: 15,
  });
  console.log('\n' + line + '\nCOMPRAS PENDIENTES DE ASIGNACIÓN (' + unassigned.length + ')\n' + line);
  for (const p of unassigned) {
    console.log(`• tx=${p.transactionId} · ${p.credits}cr · ${p.buyerEmail || '—'} · ${p.createdAt.toISOString().slice(0, 10)}`);
  }
  if (!unassigned.length) console.log('(ninguna)');

  await prisma.$disconnect();
  console.log('\n(solo-lectura — no se modificó nada)');
})().catch((e) => { console.error(e); process.exit(1); });
