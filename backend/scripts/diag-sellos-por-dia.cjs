/**
 * Diagnóstico (SOLO LECTURA): ¿se respeta `Tenant.maxStampsPerDay`?
 *
 * Busca pases que recibieron MÁS sellos en un mismo día que el tope del
 * negocio, y muestra por dónde entró cada uno: escáner, pedido, reserva o
 * automatización. El escáner es la única vía que comprueba el tope.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const rows = await p.$queryRawUnsafe(`
    WITH porDia AS (
      SELECT s."passId", s."tenantId", date_trunc('day', s."createdAt") AS dia,
             COUNT(*)::int AS sellos,
             SUM(CASE WHEN s."orderId" IS NOT NULL THEN 1 ELSE 0 END)::int AS de_pedido,
             SUM(CASE WHEN s."operatorId" IS NOT NULL THEN 1 ELSE 0 END)::int AS con_operador
        FROM "Stamp" s
       WHERE s.action IN ('STAMP','VISIT')
         AND s."createdAt" > now() - interval '45 days'
       GROUP BY 1,2,3
    )
    SELECT t."brandName", t."maxStampsPerDay" AS tope, d.sellos, d.de_pedido,
           d.con_operador, to_char(d.dia,'DD Mon') AS dia, d."passId"
      FROM porDia d JOIN "Tenant" t ON t.id = d."tenantId"
     WHERE d.sellos > GREATEST(1, COALESCE(t."maxStampsPerDay", 1))
     ORDER BY d.sellos DESC, d.dia DESC LIMIT 20`);

  if (!rows.length) {
    console.log('Ningun pase paso del tope en los ultimos 45 dias.');
  } else {
    console.log(`${rows.length} caso(s) por encima del tope (max 20 mostrados):\n`);
    console.log('NEGOCIO                     TOPE  SELLOS  DE_PEDIDO  CON_OPERADOR  DIA');
    for (const r of rows) {
      console.log(
        `  ${String(r.brandName).slice(0,26).padEnd(26)} ${String(r.tope ?? 1).padEnd(5)} ` +
        `${String(r.sellos).padEnd(7)} ${String(r.de_pedido).padEnd(10)} ` +
        `${String(r.con_operador).padEnd(13)} ${r.dia}`);
    }
  }

  const [tot] = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM "Tenant" WHERE "maxStampsPerDay" IS NOT NULL`);
  console.log(`\nNegocios con tope configurado explicitamente: ${tot.n}`);
  await p.$disconnect();
})().catch(async (e) => { console.error('FALLO:', e.message); await p.$disconnect(); process.exit(1); });
