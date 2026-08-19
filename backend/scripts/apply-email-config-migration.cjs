/**
 * Migración ADITIVA: agrega `WhiteLabel.emailConfig` (Json opcional).
 *
 * Es la conexión de email PROPIA de una marca (su cuenta Resend). Convive con
 * `emailFrom`, que ya existe y sigue funcionando igual: emailConfig es el
 * escalón de arriba, no su reemplazo.
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` sobre una columna nullable.
 * No toca datos existentes y se puede correr varias veces sin efecto.
 *
 * Uso:  railway run node scripts/apply-email-config-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const antes = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'WhiteLabel' AND column_name = 'emailConfig'
  `);
  if (antes.length) {
    console.log('La columna "emailConfig" ya existe. No hay nada que hacer.');
    return p.$disconnect();
  }

  console.log('Agregando WhiteLabel."emailConfig" (JSONB, nullable)…');
  await p.$executeRawUnsafe(
    `ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "emailConfig" JSONB`,
  );

  const despues = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'WhiteLabel' AND column_name = 'emailConfig'
  `);
  console.log('Resultado:', despues[0] || '(no se creó)');

  // Comprobación: ninguna marca pierde su remitente actual.
  const marcas = await p.$queryRawUnsafe(
    `SELECT name, slug, "emailFrom", "emailConfig" FROM "WhiteLabel" ORDER BY name`,
  );
  console.log('\nMarcas tras la migración:');
  for (const m of marcas) {
    console.log(
      `  ${m.name} (${m.slug}) → emailFrom=${m.emailFrom || '(ninguno)'}` +
        ` | emailConfig=${m.emailConfig ? 'configurado' : 'vacío (usa emailFrom)'}`,
    );
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
