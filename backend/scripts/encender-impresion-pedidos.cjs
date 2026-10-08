/**
 * Enciende (o apaga) la impresión de pedidos de un negocio:
 * `Tenant.ordersPrintEnabled`, que decide si en /app/orders/<id> aparece
 * «Imprimir» (ticket de cocina / recibo).
 *
 * Por qué un script: desde el 2026-09-11 nace apagada para todos (no era
 * fiable) y se enciende negocio por negocio a pedido, y no hay interruptor en
 * el panel. BLIC la pidió el 2026-10-08.
 *
 *   railway run --service Postgres-Nq8w node scripts/encender-impresion-pedidos.cjs blic-cali
 *   … --apagar   para quitarla
 *   … --simular  para solo ver el estado
 */
const { PrismaClient } = require('@prisma/client');

const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const APAGAR = process.argv.includes('--apagar');
const SIMULAR = process.argv.includes('--simular');
if (!slugs.length) {
  console.error('Uso: node scripts/encender-impresion-pedidos.cjs <slug> [<slug>…] [--apagar] [--simular]');
  process.exit(1);
}
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

(async () => {
  for (const slug of slugs) {
    const [t] = await p.$queryRawUnsafe(
      `SELECT id, "brandName", status, "ordersPrintEnabled" FROM "Tenant" WHERE slug = $1 AND "deletedAt" IS NULL`,
      slug,
    );
    if (!t) {
      console.warn(`⚠ No hay ningún negocio con slug «${slug}»: no se tocó nada.`);
      continue;
    }
    const quiero = !APAGAR;
    if (t.ordersPrintEnabled === quiero) {
      console.log(`${t.brandName} (${slug}, ${t.status}): la impresión ya estaba ${quiero ? 'encendida' : 'apagada'}.`);
      continue;
    }
    if (SIMULAR) {
      console.log(`[simulación] ${t.brandName} (${slug}): ${t.ordersPrintEnabled ? 'encendida' : 'apagada'} → ${quiero ? 'encendida' : 'apagada'}`);
      continue;
    }
    const n = await p.$executeRawUnsafe(
      `UPDATE "Tenant" SET "ordersPrintEnabled" = $2 WHERE id = $1`,
      t.id,
      quiero,
    );
    console.log(`✓ ${t.brandName} (${slug}): impresión ${quiero ? 'ENCENDIDA' : 'apagada'} (${n} fila).`);
  }
  const [r] = await p.$queryRawUnsafe(
    `SELECT string_agg(slug, ', ' ORDER BY slug) AS lista FROM "Tenant" WHERE "ordersPrintEnabled" AND "deletedAt" IS NULL`,
  );
  console.log(`\nNegocios con impresión: ${r.lista ?? 'ninguno'}`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
