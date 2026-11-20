/**
 * Migración ADITIVA del rol «Personalizado» del equipo de un negocio:
 *   - valor nuevo `TENANT_CUSTOM` en el enum "Role";
 *   - columna `User.permisos` (TEXT[], vacía por defecto).
 *
 * Aditiva e idempotente: `ADD VALUE IF NOT EXISTS` y `ADD COLUMN IF NOT EXISTS`.
 * No toca a ningún usuario existente (todos quedan con `permisos` vacío y su
 * rol de siempre). Se puede correr varias veces sin efecto.
 *
 * Hay que correrla ANTES de desplegar el backend que la usa: con el código
 * nuevo y sin la columna, Prisma falla al leer cualquier `User`.
 *
 * Uso (desde backend/):
 *   railway run --service backend --environment production --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
 *     node scripts/apply-rol-personalizado-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
// La URL PÚBLICA primero: la interna solo resuelve dentro de Railway.
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

(async () => {
  // ALTER TYPE … ADD VALUE no puede ir dentro de una transacción en Postgres
  // < 12, y Prisma no la abre para un $executeRawUnsafe suelto.
  await p.$executeRawUnsafe(`ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'TENANT_CUSTOM'`);
  await p.$executeRawUnsafe(
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "permisos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`,
  );

  const valores = await p.$queryRawUnsafe(
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'Role' ORDER BY e.enumsortorder`,
  );
  const columna = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'permisos'
  `);
  console.log('Role:', valores.map((v) => v.enumlabel).join(', '));
  console.log('User.permisos:', columna[0] || '(no se creó)');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  process.exitCode = 1;
  await p.$disconnect();
});
