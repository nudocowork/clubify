/**
 * Migración ADITIVA: agrega `Card.welcomeStamps` (entero, 0 por defecto).
 *
 * Son los sellos con los que arranca el cliente al instalar la tarjeta. Con 0
 * todas las tarjetas siguen igual que hoy.
 *
 * CORRER ANTES de desplegar el backend: Prisma pide la columna en cada lectura
 * de una tarjeta, y sin ella toda la app de tarjetas responde 500.
 *
 * Idempotente: `ADD COLUMN IF NOT EXISTS`. Correrlo dos veces no hace nada.
 *
 * Uso:  railway run node scripts/apply-welcome-stamps-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
// La URL PÚBLICA primero: la interna solo resuelve dentro de Railway.
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

(async () => {
  await p.$executeRawUnsafe(
    `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "welcomeStamps" INTEGER NOT NULL DEFAULT 0`,
  );
  const col = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_name = 'Card' AND column_name = 'welcomeStamps'
  `);
  console.log('Columna:', col[0] || '(NO se creó)');
  const conSellos = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Card" WHERE "welcomeStamps" > 0`,
  );
  console.log('Tarjetas con sellos de bienvenida:', conSellos[0].n, '(debe ser 0 la primera vez)');
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
