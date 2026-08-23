/**
 * Diagnóstico (SOLO LECTURA) de los grupos empresariales y su ciclo de cobro.
 * Muestra, por grupo, qué negocio tiene el código de Hotmart y si las fechas
 * de todos avanzan juntas.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const g = await p.$queryRawUnsafe(`
    SELECT bg.id, bg.name, COUNT(t.id)::int AS negocios
      FROM "BusinessGroup" bg LEFT JOIN "Tenant" t ON t."businessGroupId"=bg.id
     GROUP BY bg.id, bg.name ORDER BY bg.name`);
  console.log(`Grupos empresariales: ${g.length}\n`);
  for (const grupo of g) {
    const xs = await p.$queryRawUnsafe(`
      SELECT t."brandName", t.status, t."hotmartSubscriberCode" AS cod,
             to_char(t."currentPeriodEnd",'YYYY-MM-DD') AS proximo, t."planPeriodicity" AS per
        FROM "Tenant" t WHERE t."businessGroupId"='${grupo.id}'
       ORDER BY t."brandName"`);
    console.log(`▸ ${grupo.name} (${grupo.negocios} negocios)`);
    const fechas = new Set(xs.map((x) => x.proximo));
    for (const x of xs) {
      console.log(`    ${String(x.brandName).slice(0,26).padEnd(26)} ${String(x.status).padEnd(9)} proximo=${x.proximo} per=${x.per||'—'} cod=${x.cod||'SIN CODIGO'}`);
    }
    if (fechas.size > 1) console.log(`    ⚠️ las fechas NO coinciden: ${[...fechas].join(' · ')}`);
    console.log('');
  }
  await p.$disconnect();
})().catch(async (e) => { console.error('FALLO:', e.message); await p.$disconnect(); process.exit(1); });
