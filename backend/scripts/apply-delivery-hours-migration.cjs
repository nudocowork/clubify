/**
 * Migración ADITIVA: agrega `Tenant.deliveryHours` (JSONB opcional).
 *
 * Es el horario en que el negocio acepta pedidos a domicilio. Null o vacío =
 * se pide a cualquier hora, que es lo que hacen hoy los 136 negocios: al
 * aplicar esto NO cambia el comportamiento de ninguno.
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` sobre una columna nullable.
 * No toca datos existentes y se puede correr varias veces sin efecto.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-delivery-hours-migration.cjs
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
    WHERE table_name = 'Tenant' AND column_name = 'deliveryHours'
  `);
  if (antes.length) {
    console.log('La columna "deliveryHours" ya existe. No hay nada que hacer.');
    return;
  }

  console.log('Agregando Tenant."deliveryHours" (JSONB, nullable)…');
  await p.$executeRawUnsafe(
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "deliveryHours" JSONB`,
  );

  const despues = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'Tenant' AND column_name = 'deliveryHours'
  `);
  console.log('Resultado:', despues[0] || '(no se creó)');

  // Comprobación de que nadie se queda sin poder pedir: todos deben salir con
  // la columna vacía, o sea abiertos a cualquier hora.
  const [conteo] = await p.$queryRawUnsafe(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE "deliveryHours" IS NOT NULL)::int AS con_horario
      FROM "Tenant" WHERE "deletedAt" IS NULL
  `);
  console.log(
    `\nNegocios: ${conteo.total} · con horario configurado: ${conteo.con_horario}` +
      ` (los demás siguen recibiendo pedidos a cualquier hora).`,
  );
})()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
