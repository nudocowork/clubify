/**
 * Migración ADITIVA: agrega `IncomeRecord.businessGroupId` (texto, nullable) y
 * su índice.
 *
 * Un GRUPO EMPRESARIAL paga una sola suscripción por varios negocios. Hasta
 * ahora el libro solo sabía apuntar un cobro a UN negocio, así que el cobro de
 * «Aldehir - Grupo Mistika» ($150, tres negocios) quedaba apuntado a la
 * Cevichería Marea Mística y con el precio de SU plan ($68). Con esta columna
 * el cobro es del grupo (Javier, 2026-10-02).
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` sobre una columna nullable
 * y `CREATE INDEX IF NOT EXISTS`. No toca datos existentes y se puede correr
 * varias veces sin efecto.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-income-group-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
// Pública primero: la interna (`…railway.internal`) solo resuelve dentro de
// Railway. Ver apply-email-config-migration.cjs.
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

(async () => {
  await p.$executeRawUnsafe(
    `ALTER TABLE "IncomeRecord" ADD COLUMN IF NOT EXISTS "businessGroupId" TEXT`,
  );
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "IncomeRecord_businessGroupId_idx" ON "IncomeRecord" ("businessGroupId")`,
  );
  const col = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'IncomeRecord' AND column_name = 'businessGroupId'
  `);
  console.log('Columna:', col[0] || '(no se creó)');
  const n = await p.$queryRawUnsafe(
    `SELECT count(*)::int AS filas, count("businessGroupId")::int AS con_grupo FROM "IncomeRecord"`,
  );
  console.log('Filas del libro:', n[0]);
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
