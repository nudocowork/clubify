/**
 * Quita a los negocios de marca blanca las subcuentas GLOBALES de Clubify que
 * tengan asignadas, para que sus mensajes salgan por la subcuenta de SU marca.
 *
 * El remitente lo pone la subcuenta: un negocio de Sellea con la subcuenta
 * global asignada manda con la identidad de Clubify a sus propios clientes.
 *
 * SEGURIDAD: solo se limpia si la MARCA tiene subcuenta propia a la que caer.
 * El resolver usa `asignada > propias del negocio > marca`, así que quitar la
 * asignada sin que haya marca detrás dejaría al negocio sin canal — peor que
 * el problema que arreglamos.
 *
 * Uso:  railway run node scripts/reparar-subcuentas-de-marca.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');

(async () => {
  const filas = await p.$queryRawUnsafe(`
    SELECT t.id, t."brandName" AS negocio, w.slug AS marca,
           w."growBusinessLocationId" IS NOT NULL AND w."growBusinessApiKey" IS NOT NULL AS marcaTieneSub,
           t."reviewAlertsAccountId"   AS resenas,
           t."deliveryAlertsAccountId" AS delivery,
           t."billingAlertsAccountId"  AS cobros,
           ra."locationId" AS locResenas, da."locationId" AS locDelivery, ba."locationId" AS locCobros,
           w."growBusinessLocationId" AS locMarca
      FROM "Tenant" t
      JOIN "WhiteLabel" w ON w.id = t."whiteLabelId"
      LEFT JOIN "GrowBusinessAccount" ra ON ra.id = t."reviewAlertsAccountId"
      LEFT JOIN "GrowBusinessAccount" da ON da.id = t."deliveryAlertsAccountId"
      LEFT JOIN "GrowBusinessAccount" ba ON ba.id = t."billingAlertsAccountId"
     WHERE t."deletedAt" IS NULL AND w.slug <> 'clubify'`);

  let tocados = 0, saltados = 0;
  for (const f of filas) {
    const locMarca = f.locmarca;
    const canales = [
      ['reviewAlertsAccountId', 'reseñas', f.resenas, f.locresenas],
      ['deliveryAlertsAccountId', 'delivery', f.delivery, f.locdelivery],
      ['billingAlertsAccountId', 'cobros', f.cobros, f.loccobros],
    ].filter(([, , id, loc]) => id && loc !== locMarca);
    if (!canales.length) continue;

    console.log(`\n▸ ${f.negocio}  (${f.marca})`);
    if (!f.marcatienesub) {
      console.log(`   ⚠ la marca ${f.marca} NO tiene subcuenta propia — NO se toca:`);
      console.log(`     quitarle la asignada lo dejaría sin ningún canal.`);
      for (const [, canal] of canales) console.log(`     ${canal} sigue saliendo por la global`);
      saltados++;
      continue;
    }
    for (const [, canal] of canales) console.log(`   ${canal} → pasará a la subcuenta de ${f.marca}`);
    if (!APLICAR) continue;
    const sets = canales.map(([campo]) => `"${campo}" = NULL`).join(', ');
    await p.$executeRawUnsafe(`UPDATE "Tenant" SET ${sets} WHERE id = $1`, f.id);
    console.log('   ✓ limpiado');
    tocados++;
  }
  console.log(`\n${tocados} negocios corregidos · ${saltados} sin tocar por falta de subcuenta de marca`);
  if (!APLICAR) console.log('(simulación — nada se escribió; usa --aplicar)');
  await p.$disconnect();
})().catch(async (e) => { console.error(e.message); await p.$disconnect(); process.exit(1); });
