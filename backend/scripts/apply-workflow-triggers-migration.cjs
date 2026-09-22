/**
 * Migración ADITIVA: `triggers` (JSONB) en `MktWorkflow` y en `BrandWorkflow`
 * — varios disparadores por flujo, como en TeamClubify.
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` con `NOT NULL DEFAULT '[]'`.
 * Postgres rellena el `[]` en las filas que ya existen, y un `[]` significa
 * «flujo de antes»: los motores leen entonces `[trigger]`, así que ningún flujo
 * publicado cambia de comportamiento. No toca `trigger` ni ningún otro dato.
 * NUNCA usar `prisma db push` contra producción.
 *
 * ORDEN: correr ESTO antes de desplegar el backend que trae la columna en el
 * schema. Prisma pide todas las columnas del modelo en cada lectura, y sin la
 * columna en la base cada consulta a los flujos falla (los motores de los dos
 * constructores se quedarían parados).
 *
 * Uso:  railway run node scripts/apply-workflow-triggers-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const TABLAS = ['MktWorkflow', 'BrandWorkflow'];

(async () => {
  for (const tabla of TABLAS) {
    const antes = await p.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_name = $1 AND column_name = 'triggers'`,
      tabla,
    );
    console.log(
      antes[0].n
        ? `"${tabla}"."triggers" ya existe. No hay nada que hacer en esta tabla.`
        : `Agregando "${tabla}"."triggers" (JSONB, NOT NULL, DEFAULT '[]')…`,
    );

    // El nombre de la tabla va interpolado porque sale de la lista fija de
    // arriba, nunca de una entrada: un identificador no se puede parametrizar.
    await p.$executeRawUnsafe(
      `ALTER TABLE "${tabla}" ADD COLUMN IF NOT EXISTS "triggers" JSONB NOT NULL DEFAULT '[]'`,
    );

    const col = await p.$queryRawUnsafe(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_name = $1 AND column_name = 'triggers'`,
      tabla,
    );
    console.log(`  Columna →`, col[0] ?? '(no se creó)');

    // Comprobación: todos los flujos que ya existían quedan con la lista vacía,
    // que es justo lo que hace que el motor siga leyendo su `trigger` de siempre.
    const [total] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${tabla}"`);
    const [vacios] = await p.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "${tabla}" WHERE "triggers" = '[]'::jsonb`,
    );
    console.log(`  Flujos: ${total.n} · con la lista vacía (leen su «trigger» de siempre): ${vacios.n}`);
  }
  console.log('\nListo. Nada más de la base fue tocado.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
