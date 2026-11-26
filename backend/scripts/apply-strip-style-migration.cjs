/**
 * Migración ADITIVA: agrega `Card.stripStyle` (Json opcional).
 *
 * Es el estilo de franja que el negocio elige en el editor de tarjetas (taza,
 * cono de pizza, anillo…). `null` = el cartón clásico de siempre, así que
 * ninguna tarjeta existente cambia hasta que alguien elija un estilo.
 *
 * HAY QUE CORRERLA ANTES DE DESPLEGAR EL BACKEND que trae el campo: Prisma lee
 * todas las columnas del modelo, y sin esta cualquier consulta a `Card`
 * fallaría en producción.
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` sobre una columna nullable.
 * No toca datos existentes y se puede correr varias veces sin efecto.
 *
 * Uso:  railway run node scripts/apply-strip-style-migration.cjs
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
  const antes = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Card' AND column_name = 'stripStyle'
  `);
  if (antes.length) {
    console.log('La columna "stripStyle" ya existe. No hay nada que hacer.');
    return p.$disconnect();
  }

  console.log('Agregando Card."stripStyle" (JSONB, nullable)…');
  await p.$executeRawUnsafe(`ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "stripStyle" JSONB`);

  const despues = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'Card' AND column_name = 'stripStyle'
  `);
  console.log('Resultado:', despues[0] || '(no se creó)');

  const [{ total, con }] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS total, COUNT("stripStyle")::int AS con FROM "Card"`,
  );
  console.log(`Tarjetas: ${total}; con estilo: ${con} (debe ser 0 recién migrado).`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
