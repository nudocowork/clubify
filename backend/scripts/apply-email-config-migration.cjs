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
// `railway run` inyecta la `DATABASE_URL` INTERNA (`…railway.internal:5432`),
// que SOLO resuelve dentro de la red de Railway: desde un portátil el script
// muere con «Can't reach database server at yyy.railway.internal». Se prefiere
// la PÚBLICA y se cae a la interna, así el mismo script sirve desde fuera y
// desde dentro. (Javier, 2026-09-26.)
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

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
