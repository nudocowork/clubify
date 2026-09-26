/**
 * Mueve UN egreso de septiembre a mayo. Encargo de Javier (2026-09-26).
 *
 * EL EGRESO: «Pauta Publicitaria», $113, categoría Publicidad, PAGADO.
 * `994e9c11-4520-4252-8401-cb71d985ab21`.
 *
 * POR QUÉ ESTABA EN SEPTIEMBRE, que es lo que de verdad hay que arreglar: su
 * `expenseDate` y su `createdAt` coinciden **al milisegundo**
 * (2026-09-23T21:09:47.348Z / .349Z). Nadie tecleó esa fecha: se la puso el
 * sistema al guardar, porque **el frontend que sirve producción no tiene el
 * campo de fecha** — el backend ya lo pide (`fd4f09f`) y la pantalla desplegada
 * es anterior. Mientras el frontend no se despliegue, el siguiente egreso que
 * se registre volverá a nacer con la fecha del día.
 *
 * NO DUPLICA: se comprobó antes de tocar nada que en mayo de 2026 no hay
 * ningún egreso (de hecho, este es el ÚNICO de toda la base). No se crea una
 * fila nueva: se cambia la fecha de la que ya existe.
 *
 * LA HORA: 17:00 UTC = mediodía de Bogotá. Es la convención de Contabilidad
 * (`finance/fecha-del-movimiento.ts`, `instanteDelDia`) y existe para que el
 * día no se mueva al cruzar husos: guardado a las 00:00 UTC, el 31 de mayo se
 * lee como 30 de mayo en Colombia.
 *
 * IDEMPOTENTE: el `WHERE` exige que la fecha siga siendo la de septiembre, así
 * que correrlo dos veces no hace nada la segunda. Si alguien ya lo movió a
 * mano, este script lo dice y se va sin tocar.
 *
 * Uso:
 *   cd backend
 *   railway run --service Postgres-Nq8w node scripts/mover-egreso-pauta-a-mayo.cjs
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

const ID = '994e9c11-4520-4252-8401-cb71d985ab21';
/** Mediodía de Bogotá del 31 de mayo de 2026. */
const DESTINO = new Date('2026-05-31T17:00:00.000Z');

const ver = () =>
  p.$queryRawUnsafe(
    `SELECT id, concept, "amountUsd", status, "expenseDate", "createdAt"
     FROM "Expense" WHERE id = $1`,
    ID,
  );

(async () => {
  const [antes] = await ver();
  if (!antes) {
    console.log('No existe ese egreso. No se toca nada.');
    return p.$disconnect();
  }
  console.log('ANTES:', {
    concepto: antes.concept,
    monto: String(antes.amountUsd),
    estado: antes.status,
    fecha: antes.expenseDate.toISOString(),
  });

  if (antes.expenseDate.toISOString() === DESTINO.toISOString()) {
    console.log('Ya estaba en el 31 de mayo. Nada que hacer.');
    return p.$disconnect();
  }

  // Comprobación de «no debe quedar doble»: si alguien creó uno en mayo desde
  // que se miró, se para aquí en vez de dejar dos.
  const enMayo = await p.$queryRawUnsafe(
    `SELECT id, concept FROM "Expense"
     WHERE "expenseDate" >= '2026-05-01' AND "expenseDate" < '2026-06-01' AND id <> $1`,
    ID,
  );
  if (enMayo.length) {
    console.log('⚠ Ya hay egresos en mayo:', enMayo);
    console.log('  Se para para no dejarlo doble. Míralo antes de seguir.');
    return p.$disconnect();
  }

  const cambiadas = await p.$executeRawUnsafe(
    `UPDATE "Expense"
     SET "expenseDate" = $1, "updatedAt" = NOW()
     WHERE id = $2
       AND "expenseDate" >= '2026-09-01' AND "expenseDate" < '2026-10-01'`,
    DESTINO,
    ID,
  );
  console.log(`Filas cambiadas: ${cambiadas}`);

  const [despues] = await ver();
  console.log('DESPUÉS:', {
    concepto: despues.concept,
    monto: String(despues.amountUsd),
    estado: despues.status,
    fecha: despues.expenseDate.toISOString(),
  });

  // Que los dos meses queden como deben: mayo con uno, septiembre con ninguno.
  const [cuadre] = await p.$queryRawUnsafe(`
    SELECT
      COUNT(*) FILTER (WHERE "expenseDate" >= '2026-05-01' AND "expenseDate" < '2026-06-01')::int AS mayo,
      COUNT(*) FILTER (WHERE "expenseDate" >= '2026-09-01' AND "expenseDate" < '2026-10-01')::int AS septiembre,
      COUNT(*)::int AS total
    FROM "Expense"`);
  console.log('CUADRE:', cuadre);
  if (cuadre.mayo !== 1 || cuadre.septiembre !== 0) {
    console.log('⚠ Se esperaba mayo=1 y septiembre=0. Revísalo.');
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
