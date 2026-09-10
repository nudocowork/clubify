/**
 * Migración ADITIVA: `Location.externalId` + único por (tenantId, externalId).
 *
 * Es el id que le pone el Onboarding a cada sede. Existe para que renombrar una
 * sede en el formulario sea un cambio de nombre y no una sede nueva: casando
 * solo por nombre, corregir «Sede Cacique» por «Cacique Mall» creaba una
 * SEGUNDA sede y dejaba los productos repartidos entre las dos.
 *
 * Nullable a propósito. Las 161 sedes que ya existen se crearon antes de que
 * esto existiera y no tienen ninguno: la primera sincronización las encuentra
 * por nombre y les graba el id. Un default habría inventado ids falsos.
 *
 * El índice único es corriente, no parcial: en Postgres varios NULL conviven en
 * un índice único, así que las sedes de siempre no estorban entre ellas.
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` + `CREATE UNIQUE INDEX IF
 * NOT EXISTS`. No toca ni una fila y se puede correr varias veces sin efecto.
 *
 * Uso:  railway run node scripts/apply-location-external-id-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const INDICE = 'Location_tenantId_externalId_key';

(async () => {
  const columna = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Location' AND column_name = 'externalId'
  `);
  if (columna.length) {
    console.log('La columna "externalId" ya existe.');
  } else {
    console.log('Agregando Location."externalId" (TEXT, nullable)…');
    await p.$executeRawUnsafe(
      `ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "externalId" TEXT`,
    );
  }

  // Antes de crear el único: si dos sedes del MISMO negocio ya compartieran id
  // el índice fallaría. Con la columna recién creada esto siempre da 0, pero
  // correr el script una segunda vez sobre datos reales sí puede encontrarlo,
  // y es mejor decirlo que reventar con un error de Postgres.
  const choques = await p.$queryRawUnsafe(`
    SELECT "tenantId", "externalId", COUNT(*)::int AS n
    FROM "Location"
    WHERE "externalId" IS NOT NULL
    GROUP BY "tenantId", "externalId"
    HAVING COUNT(*) > 1
  `);
  if (choques.length) {
    console.error('ABORTA: hay sedes que comparten externalId dentro del mismo negocio:');
    for (const c of choques) {
      console.error(`  negocio ${c.tenantId} · externalId ${c.externalId} · ${c.n} sedes`);
    }
    console.error('Resolverlo a mano antes de crear el índice único.');
    await p.$disconnect();
    process.exit(1);
  }

  console.log(`Creando el índice único "${INDICE}"…`);
  await p.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "${INDICE}" ON "Location" ("tenantId", "externalId")`,
  );

  const despues = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'Location' AND column_name = 'externalId'
  `);
  const indices = await p.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'Location' ORDER BY indexname`,
  );
  console.log('\nColumna:', despues[0] || '(no se creó)');
  console.log('Índices de Location:', indices.map((i) => i.indexname).join(', '));

  // Comprobación: ninguna sede perdió nada y ninguna quedó con id inventado.
  const [conteo] = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS sedes, COUNT("externalId")::int AS con_id FROM "Location"
  `);
  console.log(
    `\nSedes: ${conteo.sedes} · con id del Onboarding: ${conteo.con_id}` +
      ' (se llenan solas en la primera sincronización)',
  );

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
