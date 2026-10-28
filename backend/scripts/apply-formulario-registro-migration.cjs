/**
 * Migración ADITIVA: el formulario de registro configurable por negocio.
 *
 *   - `Tenant.formularioRegistro` (JSONB, nullable): qué pide el formulario de
 *     la tarjeta. Null = el de la marca (Sellea exige correo y cumpleaños).
 *   - `Customer.datosDelRegistro` (JSONB, nullable): las respuestas a las
 *     casillas propias del negocio.
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` sobre columnas nullable.
 * No toca datos existentes y se puede correr varias veces sin efecto.
 * Correrla ANTES de desplegar el backend: Prisma pide las columnas al leer.
 *
 * Uso:  railway run node scripts/apply-formulario-registro-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
// La URL pública primero: la interna solo resuelve dentro de Railway.
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

(async () => {
  await p.$executeRawUnsafe(`ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "formularioRegistro" JSONB`);
  await p.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "datosDelRegistro" JSONB`);
  const cols = await p.$queryRawUnsafe(`
    SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
    WHERE (table_name = 'Tenant' AND column_name = 'formularioRegistro')
       OR (table_name = 'Customer' AND column_name = 'datosDelRegistro')
  `);
  console.log(cols);
  if (cols.length !== 2) throw new Error('Falta alguna columna.');
  console.log('Listo: las dos columnas existen.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exitCode = 1;
});
