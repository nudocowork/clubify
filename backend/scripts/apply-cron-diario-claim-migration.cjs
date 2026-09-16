/**
 * Migración ADITIVA: agrega `Tenant.ultimoCronCumpleanos` y
 * `Tenant.ultimoCronInactividad` (TEXT opcionales).
 *
 * PARA QUÉ. Los crons diarios de automatizaciones (saludo de cumpleaños y
 * «te extrañamos» de inactividad) pasan a dispararse a la hora LOCAL de cada
 * negocio en vez de a una hora UTC fija —antes salían a las 3am y a las 4am en
 * Colombia—. Para acertar la hora local de cada zona el cron corre cada hora
 * dentro de una ventana, así que hace falta una marca de «este día de este
 * negocio ya se despachó» para descartar las pasadas siguientes.
 *
 * POR QUÉ EN LA BASE Y NO EN MEMORIA. Durante un despliegue Railway mantiene
 * el contenedor viejo vivo hasta que el nuevo pasa el healthcheck: hay DOS
 * procesos con el cron armado, cada uno con su propia memoria. Y el día que
 * `numReplicas` pase de 1 (hoy está sin fijar, o sea 1 por defecto) habría uno
 * por réplica. Un candado en memoria no los ve y el saludo sale doble. Esta
 * columna la comparten todos, y se reclama con un UPDATE condicional mirando
 * el `count` — el mismo patrón que `Notification.sentAt`.
 *
 * Guarda el día local ya procesado en formato 'YYYY-MM-DD' (texto, no fecha:
 * es el día del calendario DEL NEGOCIO, no un instante).
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` sobre columnas nullable.
 * No toca datos existentes y se puede correr varias veces sin efecto.
 *
 * NULL = «nunca se ha despachado». El primer día tras aplicarla, cada negocio
 * reclama su día normalmente; no hay que rellenar nada.
 *
 * Uso:  cd backend && railway run node scripts/apply-cron-diario-claim-migration.cjs
 *
 * OJO CON EL ORDEN: aplicar ESTA migración ANTES de desplegar el backend. El
 * código nuevo lee y escribe estas columnas; sin ellas, los crons diarios
 * fallan. Al revés (columnas sin código) no rompe nada.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const COLUMNAS = ['ultimoCronCumpleanos', 'ultimoCronInactividad'];

(async () => {
  const existentes = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Tenant' AND column_name IN ('ultimoCronCumpleanos', 'ultimoCronInactividad')
  `);
  const yaEstan = existentes.map((c) => c.column_name);

  if (yaEstan.length === COLUMNAS.length) {
    console.log('Las dos columnas ya existen. No hay nada que hacer.');
    return p.$disconnect();
  }

  for (const col of COLUMNAS) {
    if (yaEstan.includes(col)) {
      console.log(`  "${col}" ya existía — se deja como está.`);
      continue;
    }
    console.log(`Agregando Tenant."${col}" (TEXT, nullable)…`);
    await p.$executeRawUnsafe(
      `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "${col}" TEXT`,
    );
  }

  const despues = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'Tenant' AND column_name IN ('ultimoCronCumpleanos', 'ultimoCronInactividad')
    ORDER BY column_name
  `);
  console.log('\nResultado:');
  for (const c of despues) {
    console.log(`  ${c.column_name} → ${c.data_type}, nullable=${c.is_nullable}`);
  }
  if (despues.length !== COLUMNAS.length) {
    throw new Error('No se crearon las dos columnas — revisar antes de desplegar.');
  }

  // Comprobación: ningún negocio se queda sin poder recibir sus crons diarios.
  const [{ negocios }] = await p.$queryRawUnsafe(
    `SELECT count(*)::int AS negocios FROM "Tenant"`,
  );
  console.log(
    `\n${negocios} negocios con el candado a NULL (= «nunca despachado»).` +
      ' Cada uno reclamará su día en la primera ventana que le toque.',
  );
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
