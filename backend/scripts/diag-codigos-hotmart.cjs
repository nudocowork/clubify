/**
 * SOLO LECTURA — códigos de suscriptor de Hotmart que no casan.
 *
 * Hotmart manda códigos de 8 caracteres. Si el guardado en el negocio tiene
 * otro largo, `findTenant` no lo reconoce y su pago recurrente cae como
 * «comprador sin cuenta»: el cliente recibe un correo de «crea tu cuenta» y la
 * alerta interna dice «nueva compra» en vez de renovación.
 *
 * Uso:  railway run node scripts/diag-codigos-hotmart.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const t = await p.$queryRawUnsafe(`
    SELECT "brandName", "hotmartSubscriberCode" AS sub, LENGTH("hotmartSubscriberCode") AS largo,
           "hotmartTransactionId" IS NULL AS sinTx, status
      FROM "Tenant"
     WHERE "deletedAt" IS NULL AND "hotmartSubscriberCode" IS NOT NULL
     ORDER BY LENGTH("hotmartSubscriberCode"), "brandName"`);
  const porLargo = {};
  for (const x of t) porLargo[x.largo] = (porLargo[x.largo] ?? 0) + 1;
  console.log('largos de codigo guardados en los negocios:');
  for (const [k, v] of Object.entries(porLargo).sort()) console.log(`  ${k} caracteres: ${v} negocios`);

  const pend = await p.$queryRawUnsafe(`
    SELECT DISTINCT "subscriberCode" AS sub, LENGTH("subscriberCode") AS largo
      FROM "PendingHotmartPayment" WHERE "subscriberCode" IS NOT NULL`);
  const largosHotmart = {};
  for (const x of pend) largosHotmart[x.largo] = (largosHotmart[x.largo] ?? 0) + 1;
  console.log('\nlargos de los codigos que MANDA Hotmart:');
  for (const [k, v] of Object.entries(largosHotmart).sort()) console.log(`  ${k} caracteres: ${v} codigos`);

  const raros = t.filter((x) => x.largo !== 8);
  console.log(`\nnegocios con codigo de largo distinto de 8: ${raros.length}`);
  for (const x of raros.slice(0, 20)) {
    console.log(`  ${String(x.brandname ?? x.brandName).padEnd(28)} "${x.sub}" (${x.largo})  sinTx=${(x.sintx ?? x.sinTx) ? 'SI' : 'no'}  ${x.status}`);
  }
  await p.$disconnect();
})().catch(async (e) => { console.error(e.message); await p.$disconnect(); process.exit(1); });
