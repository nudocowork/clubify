/**
 * SOLO LECTURA — qué pierde cada negocio si le quitamos la conexión general de
 * Clubify que hoy tiene puesta como si fuera suya.
 *
 * La conexión está enganchada en DOS capas distintas y hay que mirar las dos:
 *   capa 1: creds propias del negocio (growBusiness* en Tenant)
 *   capa 2: subcuentas asignadas (reviewAlertsAccountId / deliveryAlertsAccountId
 *           / billingAlertsAccountId)
 * El resolver usa: asignada > propias > marca. Quitar solo la capa 1 no cambia
 * nada si la capa 2 apunta a la misma subcuenta.
 *
 * Uso:  railway run node scripts/diag-impacto-quitar-creds.cjs <locationId>
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const LOC = process.argv[2] || 'ANHzFDaLU8zKeA3nFCBk';

(async () => {
  const ts = await p.$queryRawUnsafe(
    `SELECT t.id, t.name, t.status, COALESCE(w.slug,'(sin marca)') AS marca,
            t."reviewAlertsEnabled"   AS "revOn",   ra."locationId" AS "revLoc",
            t."deliveryAlertsEnabled" AS "delOn",   da."locationId" AS "delLoc",
            t."billingAlertsEnabled"  AS "cobOn",   ba."locationId" AS "cobLoc",
            w."growBusinessLocationId" IS NOT NULL AS "marcaTieneGrow"
       FROM "Tenant" t
       LEFT JOIN "WhiteLabel" w  ON w.id  = t."whiteLabelId"
       LEFT JOIN "GrowBusinessAccount" ra ON ra.id = t."reviewAlertsAccountId"
       LEFT JOIN "GrowBusinessAccount" da ON da.id = t."deliveryAlertsAccountId"
       LEFT JOIN "GrowBusinessAccount" ba ON ba.id = t."billingAlertsAccountId"
      WHERE t."growBusinessLocationId" = $1 AND t."deletedAt" IS NULL
      ORDER BY t.name`, LOC);

  console.log(`Negocios con ${LOC} como creds PROPIAS: ${ts.length}\n`);
  for (const t of ts) {
    console.log(`▸ ${t.name}  (${t.marca}, ${t.status})`);
    const canal = (nombre, on, loc) => {
      if (!on) return `  ${nombre.padEnd(9)} apagado — da igual`;
      if (loc === LOC) return `  ${nombre.padEnd(9)} ENCENDIDO y la subcuenta asignada es la MISMA → sigue saliendo por Clubify aunque quitemos las creds propias`;
      if (loc) return `  ${nombre.padEnd(9)} ENCENDIDO, asignada distinta (${loc}) → no le afecta`;
      const destino = t.marcaTieneGrow ? 'cae a la subcuenta de su marca' : 'SE QUEDA SIN CANAL';
      return `  ${nombre.padEnd(9)} ENCENDIDO, sin asignada → al quitar las propias ${destino}`;
    };
    console.log(canal('reseñas', t.revOn, t.revLoc));
    console.log(canal('delivery', t.delOn, t.delLoc));
    console.log(canal('cobros', t.cobOn, t.cobLoc));
    console.log('');
  }
  await p.$disconnect();
})().catch(async (e) => { console.error(e.message); await p.$disconnect(); process.exit(1); });
