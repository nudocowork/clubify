// Tercer arqueo: POR QUÉ esas dos transacciones de Hotmart no llegaron al libro.
//
// La hipótesis a descartar es que `subscriptionPriceUsd` del negocio esté en 0
// (no en null): `record()` salta todo importe <= 0, así que un 0 guardado en el
// negocio hace desaparecer el ingreso en silencio.
//
// No escribe nada.
// Uso: railway run --service Postgres-Nq8w node scripts/arqueo-contabilidad-porque.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const filas = await prisma.$queryRawUnsafe(`
    SELECT t.id, t."brandName", t.status, t.email,
           t."subscriptionPriceUsd" AS precio,
           (t."subscriptionPriceUsd" IS NULL) AS precio_es_null,
           t."planPeriodicity", t."planId", t."hotmartTransactionId",
           t."hotmartSubscriberCode", t."purchasedAt", t."lastChargeAt",
           t."currentPeriodEnd", t."lastPaymentAmountUsd", t."whiteLabelId",
           p.name AS plan_nombre, p."priceMonthly" AS plan_precio
    FROM "Tenant" t
    LEFT JOIN "Plan" p ON p.id = t."planId"
    WHERE t."deletedAt" IS NULL
      AND t."brandName" IN ('Chillin Sports & Wings','Slata','BLIC','Moa café ca','Oh! Cookies')
  `);
  console.log('════════ LOS 5 NEGOCIOS, CAMPOS CRUDOS\n');
  for (const f of filas) {
    console.log(`  ${f.brandName} [${f.status}] ${f.email}`);
    console.log(`    subscriptionPriceUsd = ${f.precio_es_null ? 'NULL' : f.precio}  ← ${f.precio_es_null ? 'cae al canónico' : 'se usa tal cual'}`);
    console.log(`    plan "${f.plan_nombre}" precio ${f.plan_precio} · periodicidad ${f.planPeriodicity}`);
    console.log(`    hotmartTx=${f.hotmartTransactionId || '—'} sub=${f.hotmartSubscriberCode || '—'} ` +
      `purchasedAt=${f.purchasedAt ? String(f.purchasedAt).slice(0, 10) : 'NULL'} lastPaymentAmountUsd=${f.lastPaymentAmountUsd}`);
    console.log('');
  }

  console.log('════════ PRECIOS CANÓNICOS EN SETTINGS\n');
  const s = await prisma.setting.findMany({
    where: { key: { contains: 'price' } },
    select: { key: true, value: true },
  });
  for (const x of s) console.log(`  ${x.key} = ${x.value}`);
  const s2 = await prisma.setting.findMany({
    where: { OR: [{ key: { contains: 'bundle' } }, { key: { startsWith: 'finance.' } }, { key: { contains: 'canonical' } }] },
    select: { key: true, value: true },
  });
  for (const x of s2) console.log(`  ${x.key} = ${x.value}`);

  console.log('\n════════ PLANES\n');
  const planes = await prisma.$queryRawUnsafe(
    `SELECT id, name, "priceMonthly" FROM "Plan" ORDER BY name`,
  ).catch(() => null);
  if (planes) for (const p of planes) console.log(`  ${p.id} "${p.name}" ${p.priceMonthly}`);

  console.log('\n════════ EL COMPRADOR SIN NEGOCIO (HP2209512687)\n');
  const pend = await prisma.pendingHotmartPayment.findMany({
    where: { OR: [{ buyerEmail: 'info@medicenache.com' }, { transactionId: 'HP2209512687' }] },
  }).catch((e) => { console.log('  (PendingHotmartPayment:', e.message.split('\n')[0], ')'); return []; });
  for (const p of pend) console.log('  ', JSON.stringify(p));
  const porCorreo = await prisma.$queryRawUnsafe(`
    SELECT id, "brandName", email, status, "hotmartSubscriberCode", "deletedAt"
    FROM "Tenant" WHERE email ILIKE '%medicenache%' OR "hotmartSubscriberCode" = 'YKUPT9FQ'
  `);
  console.log('  negocios que casan por correo o suscriptor:', porCorreo.length);
  for (const t of porCorreo) console.log('   ', JSON.stringify(t));

  const usuarios = await prisma.$queryRawUnsafe(`
    SELECT id, email, role, "tenantId" FROM "User" WHERE email ILIKE '%medicenache%'
  `).catch(() => []);
  console.log('  usuarios con ese correo:', usuarios.length, JSON.stringify(usuarios));

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
