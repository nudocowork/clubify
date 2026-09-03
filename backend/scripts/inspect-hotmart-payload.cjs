// SOLO-LECTURA: inspecciona la estructura de payloads Hotmart reales guardados
// (HotmartCreditPurchase.rawPayload + HotmartWebhookEvent) para ver DÓNDE viaja
// el tracking/src/sck. No modifica nada.
//   railway run --service Postgres-Nq8w node scripts/inspect-hotmart-payload.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const purchases = await prisma.hotmartCreditPurchase.findMany({
    where: { rawPayload: { not: null } },
    select: { transactionId: true, rawPayload: true, createdAt: true },
    orderBy: { createdAt: 'desc' }, take: 3,
  });
  console.log(`HotmartCreditPurchase con payload: ${purchases.length}`);
  for (const p of purchases) {
    const d = (p.rawPayload && p.rawPayload.data) || {};
    console.log('\n=== tx', p.transactionId, '===');
    console.log('data keys:', Object.keys(d));
    if (d.purchase) console.log('purchase keys:', Object.keys(d.purchase));
    console.log('purchase.tracking:', JSON.stringify(d.purchase?.tracking ?? null));
    console.log('purchase.sckPaymentLink:', JSON.stringify(d.purchase?.sckPaymentLink ?? null));
  }

  // Si no hay purchases, mirar cualquier evento Hotmart logueado.
  if (purchases.length === 0) {
    console.log('\n(sin purchases; probando HotmartWebhookEvent)');
    try {
      const ev = await prisma.hotmartWebhookEvent.findMany({
        select: { eventId: true, eventType: true, payload: true, processedAt: true },
        orderBy: { processedAt: 'desc' }, take: 5,
      });
      console.log('eventos:', ev.length);
      for (const e of ev) {
        const d = (e.payload && e.payload.data) || {};
        console.log('\n=== event', e.eventId, '· type', e.eventType, '===');
        if (d.purchase) console.log('purchase keys:', Object.keys(d.purchase));
        console.log('purchase.tracking:', JSON.stringify(d.purchase?.tracking ?? null));
        console.log('purchase.sckPaymentLink:', JSON.stringify(d.purchase?.sckPaymentLink ?? null));
        console.log('product:', JSON.stringify(d.product ?? null));
      }
    } catch (err) {
      console.log('HotmartWebhookEvent no tiene payload column o no existe:', err.message);
    }
  }

  await prisma.$disconnect();
  console.log('\n(solo-lectura)');
})().catch((e) => { console.error(e.message); process.exit(1); });
