/**
 * SOLO LECTURA — negocios que tienen como credenciales PROPIAS una subcuenta
 * que en realidad es de la plataforma o de una marca.
 *
 * Por qué importa: esas creds las usan los mensajes que el NEGOCIO manda a SUS
 * clientes (reseñas, pedidos, reservas). Si la subcuenta es la nuestra, el
 * cliente final recibe un mensaje con la identidad de Clubify en vez de la del
 * negocio — la dirección queda invertida.
 *
 * Uso:  railway run node scripts/diag-creds-prestadas.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const si = (v) => (v ? 'sí' : 'no');

(async () => {
  const propias = await p.$queryRawUnsafe(
    `SELECT id, name, "locationId" FROM "GrowBusinessAccount" WHERE "deletedAt" IS NULL`);
  const marcas = await p.$queryRawUnsafe(
    `SELECT slug, "growBusinessLocationId" AS loc FROM "WhiteLabel"
      WHERE "growBusinessLocationId" IS NOT NULL`);
  const ajenas = new Map();
  for (const a of propias) ajenas.set(a.locationId, `subcuenta global "${a.name}"`);
  for (const m of marcas) ajenas.set(m.loc, `subcuenta de la marca ${m.slug}`);

  const ts = await p.$queryRawUnsafe(
    `SELECT t.id, t.name, t.slug, t.status, t."growBusinessLocationId" AS loc,
            COALESCE(w.slug,'(sin marca)') AS marca,
            t."billingAlertsAccountId" IS NOT NULL AS "ctaCobros",
            t."reviewAlertsAccountId"  IS NOT NULL AS "ctaResenas",
            t."deliveryAlertsAccountId" IS NOT NULL AS "ctaDelivery"
       FROM "Tenant" t LEFT JOIN "WhiteLabel" w ON w.id = t."whiteLabelId"
      WHERE t."growBusinessLocationId" IS NOT NULL AND t."deletedAt" IS NULL
      ORDER BY t.name`);

  for (const t of ts) {
    const quien = ajenas.get(t.loc);
    console.log(`\n▸ ${t.name}  (${t.marca}, ${t.status})`);
    console.log(`  locationId propio: ${t.loc}`);
    console.log(`  ¿es ajena?         ${quien ? 'SÍ — ' + quien : 'no, parece suya'}`);
    console.log(`  cuentas asignadas: cobros=${si(t.ctaCobros)} reseñas=${si(t.ctaResenas)} delivery=${si(t.ctaDelivery)}`);

    // ¿qué features podrían estar mandando por esas creds?
    const [r] = await p.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "ReviewRequest" WHERE "tenantId" = $1`, t.id
    ).catch(() => [{ n: null }]);
    const [o] = await p.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "Order" WHERE "tenantId" = $1`, t.id
    ).catch(() => [{ n: null }]);
    console.log(`  uso real:          reseñas=${r?.n ?? '¿?'}  pedidos=${o?.n ?? '¿?'}`);
  }
  if (!ts.length) console.log('(ningún negocio tiene creds propias)');
  await p.$disconnect();
})().catch(async (e) => { console.error(e.message); await p.$disconnect(); process.exit(1); });
