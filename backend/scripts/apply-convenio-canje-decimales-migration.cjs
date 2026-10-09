/**
 * Migración: "ConvenioCanje"."compraMonto" y "descuentoMonto" de INTEGER a
 * NUMERIC(12,2), para que el total del tiquete de una alianza lleve centavos
 * (negocios en dólares; 2026-10-08). Ensancha el tipo: ningún valor guardado
 * cambia (un entero cabe tal cual). Idempotente: si ya es numeric, no hace nada.
 *
 *   railway run --service Postgres-Nq8w node scripts/apply-convenio-canje-decimales-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
(async () => {
  for (const col of ['compraMonto', 'descuentoMonto']) {
    const [c] = await p.$queryRawUnsafe(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'ConvenioCanje' AND column_name = $1`,
      col,
    );
    if (!c) throw new Error(`No existe "ConvenioCanje"."${col}"`);
    if (c.data_type === 'numeric') {
      console.log(`${col}: ya es decimal, nada que hacer.`);
      continue;
    }
    await p.$executeRawUnsafe(
      `ALTER TABLE "ConvenioCanje" ALTER COLUMN "${col}" TYPE NUMERIC(12,2) USING "${col}"::NUMERIC(12,2)`,
    );
    console.log(`${col}: ${c.data_type} → numeric(12,2).`);
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
