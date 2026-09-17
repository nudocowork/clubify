/**
 * Migración ADITIVA: agrega `FinancialClose.socioUsd` (DECIMAL(12,2), default 0).
 *
 * La cascada de utilidad tiene desde el 2026-09-17 una línea «Socio» (su % del
 * neto de las ventas de Clubify, ver `src/finance/socio.ts`). Un cierre de mes
 * congela la cascada: sin esta columna, el cierre guardaría una utilidad ya
 * descontada sin decir cuánto se llevó el socio.
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` con default 0. Los cierres
 * que ya existen quedan con 0, que es la verdad: se cerraron sin socio.
 * Hay que aplicarla ANTES de desplegar el backend: el cliente de Prisma nuevo
 * pide la columna en toda consulta a `FinancialClose`.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-socio-cierre-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');

// Desde esta máquina la URL interna (`*.railway.internal`) no resuelve: la
// pública primero, si está.
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);

(async () => {
  const antes = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'FinancialClose' AND column_name = 'socioUsd'
  `);
  if (antes.length) {
    console.log('La columna "socioUsd" ya existe. No hay nada que hacer.');
    return p.$disconnect();
  }

  console.log('Agregando FinancialClose."socioUsd" (DECIMAL(12,2), default 0)…');
  await p.$executeRawUnsafe(
    `ALTER TABLE "FinancialClose" ADD COLUMN IF NOT EXISTS "socioUsd" DECIMAL(12,2) NOT NULL DEFAULT 0`,
  );

  const despues = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_name = 'FinancialClose' AND column_name = 'socioUsd'
  `);
  console.log('Resultado:', despues[0] || '(no se creó)');

  const cierres = await p.$queryRawUnsafe(
    `SELECT period, scope, "utilidadUsd", "socioUsd" FROM "FinancialClose" ORDER BY period`,
  );
  console.log(`\nCierres existentes (${cierres.length}), sin tocar su utilidad:`);
  for (const c of cierres) {
    console.log(`  ${c.period} (${c.scope}) utilidad=${c.utilidadUsd} socio=${c.socioUsd}`);
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
