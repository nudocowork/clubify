/**
 * Pone en el libro QUIÉN pagó lo que las marcas blancas le pagaron a Clubify
 * (Sara, 2026-10-03: «la compra de créditos suma a los ingresos de Clubify»).
 *
 *  1. Packs de créditos comprados por una marca (HotmartCreditPurchase con
 *     marca ≠ Clubify): estaban a nombre de la MARCA y no contaban como ingreso
 *     de Clubify. Pasan a whiteLabelId = Clubify, payerWhiteLabelId = la marca.
 *  2. Los cobros de Hotmart cuyo comprador es un ADMIN de una marca blanca
 *     (p. ej. Humberto García, de Sellea: «Automatización de WhatsApp», $99,03
 *     al mes): son un servicio que la marca le paga a Clubify.
 *
 * Idempotente: solo toca filas sin `payerWhiteLabelId`. Simula por defecto.
 *
 *   railway run --service Postgres-Nq8w node scripts/asignar-ingresos-de-marcas.cjs            # simula
 *   railway run --service Postgres-Nq8w node scripts/asignar-ingresos-de-marcas.cjs --aplicar --servicio "Automatización de WhatsApp"
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const APLICAR = process.argv.includes('--aplicar');
// El nombre del servicio que pagan los admins de marca. Hotmart no lo trae
// legible (la oferta de Humberto se llama «100$»): lo dice quien lo vende.
const i = process.argv.indexOf('--servicio');
const SERVICIO = i > 0 && process.argv[i + 1] ? process.argv[i + 1] : 'Servicio de la marca';

(async () => {
  const clubify = (await p.whiteLabel.findFirst({ where: { slug: 'clubify' }, select: { id: true } }))?.id;
  if (!clubify) throw new Error('No existe la marca Clubify');
  const marcas = await p.whiteLabel.findMany({ select: { id: true, name: true } });
  const nombre = Object.fromEntries(marcas.map((m) => [m.id, m.name]));
  const cambios = [];

  // Toda compra de créditos de Hotmart, sea de la marca que sea.
  const esCompraDeCreditos = new Set(
    (await p.hotmartCreditPurchase.findMany({ select: { transactionId: true } })).map((c) => c.transactionId),
  );

  // 1. Packs de créditos de una marca.
  const compras = await p.hotmartCreditPurchase.findMany({
    where: { whiteLabelId: { not: null, notIn: [clubify] } },
    select: { transactionId: true, whiteLabelId: true },
  });
  for (const c of compras) {
    const fila = await p.incomeRecord.findFirst({
      where: { externalTxId: c.transactionId, payerWhiteLabelId: null },
      select: { id: true, externalTxId: true, grossUsd: true, whiteLabelId: true },
    });
    if (fila) cambios.push({ fila, data: { whiteLabelId: clubify, payerWhiteLabelId: c.whiteLabelId }, porque: `créditos de ${nombre[c.whiteLabelId]}` });
  }

  // 2. Cobros de Hotmart pagados por el admin de una marca blanca.
  const admins = await p.user.findMany({
    where: { role: 'SUPER_ADMIN', whiteLabelId: { not: null, notIn: [clubify] } },
    select: { email: true, fullName: true, whiteLabelId: true },
  });
  for (const a of admins) {
    const eventos = await p.$queryRawUnsafe(
      `SELECT DISTINCT payload->'data'->'purchase'->>'transaction' AS tx,
              COALESCE(NULLIF(payload->'data'->'purchase'->'offer'->>'description',''), payload->'data'->'product'->>'name') AS producto
         FROM "HotmartWebhookEvent"
        WHERE lower(payload->'data'->'buyer'->>'email') = lower($1)
          AND "eventType" IN ('PURCHASE_APPROVED','PURCHASE_COMPLETE')`,
      a.email,
    );
    for (const e of eventos) {
      if (!e.tx) continue;
      const fila = await p.incomeRecord.findFirst({
        where: { externalTxId: e.tx, payerWhiteLabelId: null, tenantId: null, businessGroupId: null },
        select: { id: true, externalTxId: true, grossUsd: true, whiteLabelId: true },
      });
      if (!fila) continue;
      // Ya tratado arriba si era un pack de créditos.
      if (cambios.some((x) => x.fila.id === fila.id)) continue;
      // Créditos comprados por el admin: siguen siendo créditos; solo se anota
      // quién los pagó. Lo demás es un servicio que la marca le paga a Clubify.
      const creditos = esCompraDeCreditos.has(e.tx);
      cambios.push({
        fila,
        data: creditos
          ? { whiteLabelId: clubify, payerWhiteLabelId: a.whiteLabelId }
          : {
              whiteLabelId: clubify,
              payerWhiteLabelId: a.whiteLabelId,
              category: 'MARCA_BLANCA',
              brandName: `${nombre[a.whiteLabelId]} (marca blanca)`,
              productName: `Servicio: ${SERVICIO}`.slice(0, 120),
            },
        porque: `${creditos ? 'créditos' : 'servicio «' + SERVICIO + '»'} pagado por ${a.fullName} (admin de ${nombre[a.whiteLabelId]}) · oferta «${e.producto ?? ''}»`,
      });
    }
  }

  let total = 0;
  for (const c of cambios) {
    total += Number(c.fila.grossUsd);
    console.log(`${APLICAR ? 'APLICO' : 'simulo'} ${c.fila.externalTxId} $${c.fila.grossUsd} (antes marca=${nombre[c.fila.whiteLabelId] ?? 'ninguna'}) → ${c.porque}`);
    if (APLICAR) await p.incomeRecord.update({ where: { id: c.fila.id }, data: c.data });
  }
  console.log(`${cambios.length} fila(s), $${total.toFixed(2)} que pasan a contar como ingreso de Clubify pagado por una marca.${APLICAR ? '' : ' (simulación: --aplicar para escribir)'}`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
