/**
 * Rellena `MessageLog.whiteLabelId` a partir del negocio.
 *
 * Los SMS del cron nacían sin marca porque el llamador solo pasaba el negocio.
 * Como la lectura trataba «sin marca» como legacy de Clubify, un recordatorio de
 * Acqua Nails (Sellea) apareció listado en el panel de Clubify. El código ya
 * deduce la marca al escribir; esto repara lo que quedó guardado antes.
 *
 * Uso:  railway run node scripts/backfill-marca-mensajes.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');

(async () => {
  const huerfanas = await p.$queryRawUnsafe(`
    SELECT m.id, m.channel, m."templateId", m."createdAt",
           t.name AS negocio, t."whiteLabelId" AS marca, w.slug
      FROM "MessageLog" m
      LEFT JOIN "Tenant" t ON t.id = m."tenantId"
      LEFT JOIN "WhiteLabel" w ON w.id = t."whiteLabelId"
     WHERE m."whiteLabelId" IS NULL
     ORDER BY m."createdAt"`);

  const conNegocio = huerfanas.filter((h) => h.marca);
  const sinNegocio = huerfanas.filter((h) => !h.marca);

  console.log(`filas sin marca: ${huerfanas.length}`);
  console.log(`  se pueden reparar (tienen negocio): ${conNegocio.length}`);
  console.log(`  quedan sin marca (sin negocio):     ${sinNegocio.length}\n`);

  for (const h of conNegocio) {
    console.log(`  ${new Date(h.createdAt).toISOString().slice(0, 16)}  ${String(h.channel).padEnd(9)} ${h.negocio}  →  ${h.slug}`);
    if (!APLICAR) continue;
    await p.$executeRawUnsafe(
      `UPDATE "MessageLog" SET "whiteLabelId" = $1 WHERE id = $2`, h.marca, h.id);
  }
  if (sinNegocio.length) {
    console.log('\n  Sin negocio asociado (no se les puede deducir la marca):');
    for (const h of sinNegocio) {
      console.log(`    ${new Date(h.createdAt).toISOString().slice(0, 16)}  ${h.channel}  ${h.templateId ?? '—'}`);
    }
    console.log('  Quedan sin marca a propósito: ya NO se le atribuyen a Clubify.');
  }
  if (!APLICAR) { console.log('\n(nada se escribió — usa --aplicar)'); }
  else {
    const [q] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "MessageLog" WHERE "whiteLabelId" IS NULL`);
    console.log(`\n✓ listo. Quedan ${q.n} sin marca (las que no tienen negocio).`);
  }
  await p.$disconnect();
})().catch(async (e) => { console.error(e.message); await p.$disconnect(); process.exit(1); });
