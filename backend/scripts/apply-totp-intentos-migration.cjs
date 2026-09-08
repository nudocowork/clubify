#!/usr/bin/env node
/**
 * Migración aditiva: contador de fallos y bloqueo temporal del segundo factor.
 *
 * Por qué: `/auth/2fa/challenge` no tenía ningún límite de intentos. Con la
 * tolerancia de ±30 s hay unos tres códigos válidos por ventana y verificar
 * cuesta un HMAC, así que —sin límite de peticiones que funcione (P0-2)— el
 * segundo factor de una cuenta con la contraseña ya filtrada era cuestión de
 * insistir. Ver `docs/QA-MASTER-SECURITY.md`, P0-8.
 *
 * Aditiva e idempotente: dos columnas con valor por defecto. No borra ni cambia
 * nada existente, y se puede correr las veces que haga falta.
 *
 * IMPORTANTE — el orden importa: esto va ANTES de desplegar el backend. El
 * código nuevo lee `totpFallos`; si se despliega primero, el login con segundo
 * factor falla.
 *
 *   railway run node backend/scripts/apply-totp-intentos-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');

const COLUMNAS = [
  { nombre: 'totpFallos', sql: '"totpFallos" INTEGER NOT NULL DEFAULT 0' },
  { nombre: 'totpBloqueadoHasta', sql: '"totpBloqueadoHasta" TIMESTAMP(3)' },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const url = process.env.DATABASE_URL || '';
    const host = url.replace(/^.*@/, '').replace(/\/.*$/, '') || '(desconocido)';
    console.log(`\nBase de datos: ${host}\n`);

    for (const col of COLUMNAS) {
      const existe = await prisma.$queryRawUnsafe(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'User' AND column_name = '${col.nombre}'`,
      );
      if (Array.isArray(existe) && existe.length > 0) {
        console.log(`  ${col.nombre}: ya existe, no se toca.`);
        continue;
      }
      console.log(`  ${col.nombre}: añadiendo...`);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS ${col.sql}`,
      );
    }

    const final = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'User' AND column_name IN ('totpFallos','totpBloqueadoHasta')`,
    );
    if (!Array.isArray(final) || final.length !== 2) {
      throw new Error('Faltan columnas después del ALTER. Revisar a mano.');
    }
    console.log('\nListo. Ahora sí se puede desplegar el backend.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('\nFalló la migración:', e.message, '\n');
  process.exit(1);
});
