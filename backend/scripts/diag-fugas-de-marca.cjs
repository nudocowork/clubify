/**
 * SOLO LECTURA — ¿los mensajes de cada negocio salen por la subcuenta de SU
 * marca, o por la de otra?
 *
 * El remitente lo pone la subcuenta de Grow Business. Si un negocio de Sellea
 * manda por la subcuenta de Clubify, su cliente recibe el mensaje con la
 * identidad equivocada.
 *
 * Uso:  railway run node scripts/diag-fugas-de-marca.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const marcas = await p.$queryRawUnsafe(`
    SELECT id, slug, name, "growBusinessLocationId" AS loc, domain, "appDomain" AS app
      FROM "WhiteLabel" ORDER BY slug`);
  const porLoc = new Map(marcas.filter((m) => m.loc).map((m) => [m.loc, m.slug]));
  const cuentas = await p.$queryRawUnsafe(
    `SELECT name, "locationId" FROM "GrowBusinessAccount" WHERE "deletedAt" IS NULL`);
  for (const c of cuentas) if (!porLoc.has(c.locationId)) porLoc.set(c.locationId, `global:${c.name}`);

  console.log('=== dominios por marca ===');
  for (const m of marcas) {
    console.log(`  ${m.slug.padEnd(10)} panel=${m.app ?? '— (cae a soyclubify)'}   web=${m.domain ?? '—'}`);
  }

  console.log('\n=== negocios que mandarian por una subcuenta que NO es la de su marca ===');
  const t = await p.$queryRawUnsafe(`
    SELECT t."brandName", w.slug AS marca, w."growBusinessLocationId" AS locMarca,
           t."growBusinessLocationId" AS locPropia,
           ra."locationId" AS locResenas, da."locationId" AS locDelivery, ba."locationId" AS locCobros
      FROM "Tenant" t
      JOIN "WhiteLabel" w ON w.id = t."whiteLabelId"
      LEFT JOIN "GrowBusinessAccount" ra ON ra.id = t."reviewAlertsAccountId"
      LEFT JOIN "GrowBusinessAccount" da ON da.id = t."deliveryAlertsAccountId"
      LEFT JOIN "GrowBusinessAccount" ba ON ba.id = t."billingAlertsAccountId"
     WHERE t."deletedAt" IS NULL AND w.slug <> 'clubify'`);
  let malos = 0;
  for (const x of t) {
    const marca = x.locmarca ?? x.locMarca;
    const canales = [
      ['reseñas', x.locresenas ?? x.locResenas],
      ['delivery', x.locdelivery ?? x.locDelivery],
      ['cobros', x.loccobros ?? x.locCobros],
      ['propias', x.locpropia ?? x.locPropia],
    ].filter(([, loc]) => loc && loc !== marca);
    if (!canales.length) continue;
    malos++;
    console.log(`  ${String(x.brandname ?? x.brandName).padEnd(24)} (${x.marca})`);
    for (const [canal, loc] of canales) {
      console.log(`     ${canal.padEnd(10)} sale por ${porLoc.get(loc) ?? loc} — deberia ser ${x.marca}`);
    }
  }
  if (!malos) console.log('  ninguno: todos los negocios de marca blanca mandan por su propia marca');
  await p.$disconnect();
})().catch(async (e) => { console.error(e.message); await p.$disconnect(); process.exit(1); });
