/**
 * ENDURECIMIENTO (opcional): índice único parcial que impide inscribir DOS
 * veces por el mismo evento de ventas.
 *
 * QUÉ PROBLEMA CIERRA
 * -------------------
 * El barrido de cada hora (`escanearVentas`, en mkt-engine.service.ts) mira una
 * ventana de 90 minutos para que ningún cambio se cuele entre dos vueltas del
 * cron. El precio es que el mismo cambio se ve dos veces, así que cada evento
 * lleva una referencia (`context->>'eventoRef'`) y el motor la compara con las
 * inscripciones recientes antes de inscribir.
 *
 * Esa comparación se hace EN MEMORIA y basta mientras el cron corre en un solo
 * proceso, que es el caso hoy. El día que haya dos pods, los dos podrían leer
 * «todavía no» a la vez. Este índice lo decide la base: la segunda inscripción
 * choca, `enroll` devuelve «omitido» y no sale un segundo correo.
 *
 * POR QUÉ NO ESTÁ EN schema.prisma
 * --------------------------------
 * Prisma no sabe expresar un índice sobre una EXPRESIÓN de un campo JSON, ni
 * uno parcial. Es el mismo caso que los índices únicos parciales de
 * `MktContact` que ya viven solo en producción. No se añade ninguna columna:
 * el código funciona igual con el índice y sin él, así que este script se puede
 * aplicar antes o después de desplegar, o no aplicarse.
 *
 * Aditivo e idempotente: `CREATE UNIQUE INDEX IF NOT EXISTS`. No toca datos.
 *
 * Uso:  railway run node scripts/apply-mkt-eventos-de-ventas.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const INDICE = 'MktEnrollment_workflow_eventoRef_key';

(async () => {
  const antes = await p.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'MktEnrollment' AND indexname = '${INDICE}'`,
  );
  if (antes.length) {
    console.log(`El índice "${INDICE}" ya existe. No hay nada que hacer.`);
    return p.$disconnect();
  }

  // Antes de crear un índice ÚNICO hay que saber si los datos lo aguantan: si
  // ya hubiera dos inscripciones del mismo flujo por el mismo evento, el CREATE
  // fallaría a medias y nos enteraríamos por un despliegue roto.
  const repetidos = await p.$queryRawUnsafe(`
    SELECT "workflowId", "context" ->> 'eventoRef' AS ref, COUNT(*)::int AS n
    FROM "MktEnrollment"
    WHERE "context" ->> 'eventoRef' IS NOT NULL
    GROUP BY 1, 2
    HAVING COUNT(*) > 1
  `);
  if (repetidos.length) {
    console.error(`Hay ${repetidos.length} evento(s) con inscripciones repetidas; el índice no se puede crear tal cual:`);
    for (const r of repetidos.slice(0, 20)) {
      console.error(`  flujo ${r.workflowId} · evento ${r.ref} → ${r.n} inscripciones`);
    }
    console.error('Revísalos antes de seguir: son contactos que recibieron el mismo mensaje dos veces.');
    await p.$disconnect();
    process.exit(1);
  }

  console.log(`Creando el índice único parcial "${INDICE}"…`);
  await p.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "${INDICE}"
      ON "MktEnrollment" ("workflowId", (("context" ->> 'eventoRef')))
      WHERE ("context" ->> 'eventoRef') IS NOT NULL
  `);

  const despues = await p.$queryRawUnsafe(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'MktEnrollment' AND indexname = '${INDICE}'`,
  );
  console.log('Resultado:', despues[0] || '(no se creó)');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
