#!/usr/bin/env node
/**
 * Migración aditiva: contador de intentos en PasswordResetToken.
 *
 * Por qué: el código de restablecimiento por SMS son seis dígitos y no tenía
 * tope de intentos. Sin límite de peticiones que funcione (P0-2), eso se
 * adivina en minutos y se toma la cuenta con solo el número de teléfono.
 * Ver `docs/QA-MASTER-SECURITY.md`, P0-7.
 *
 * Es aditiva e idempotente: añade una columna con valor por defecto y se puede
 * correr las veces que haga falta. NO borra ni cambia nada existente.
 *
 * IMPORTANTE — el orden importa: esto va ANTES de desplegar el backend. El
 * código nuevo lee `attempts`; si se despliega primero, las consultas fallan.
 *
 *   railway run node backend/scripts/apply-reset-token-attempts-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    const url = process.env.DATABASE_URL || '';
    // No se dice la contraseña en el log, solo a qué host se apunta.
    const host = url.replace(/^.*@/, '').replace(/\/.*$/, '') || '(desconocido)';
    console.log(`\nBase de datos: ${host}\n`);

    const antes = await prisma.$queryRawUnsafe(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'PasswordResetToken' AND column_name = 'attempts'
    `);
    if (Array.isArray(antes) && antes.length > 0) {
      console.log('La columna `attempts` ya existe. No hay nada que hacer.\n');
      return;
    }

    console.log('Añadiendo `attempts` a PasswordResetToken...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "PasswordResetToken"
      ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0
    `);

    const despues = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'PasswordResetToken' AND column_name = 'attempts'
    `);
    if (!Array.isArray(despues) || despues.length === 0) {
      throw new Error('La columna no aparece después del ALTER. Revisar a mano.');
    }
    console.log('Listo:', JSON.stringify(despues[0]));
    console.log('\nAhora sí se puede desplegar el backend.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('\nFalló la migración:', e.message, '\n');
  process.exit(1);
});
