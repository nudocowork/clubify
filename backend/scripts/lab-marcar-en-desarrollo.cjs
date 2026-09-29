/**
 * Pasa a EN DESARROLLO las propuestas del Lab que se están atendiendo.
 *
 * Javier, 2026-09-29: «revisa una a una las solicitudes de Humberto y marcálas
 * como en proceso o en desarrollo». Esto es solo la marca; el trabajo va en sus
 * propios commits.
 *
 * `PENDING → IN_DEVELOPMENT` es una transición permitida (ver
 * `transiciones-de-estado.spec.ts`): para un ticket de una marca blanca no hay
 * que pasar por evaluación ni votación, que es para las ideas de la comunidad.
 *
 * Cambiar el estado NO manda ningún aviso —el SMS del Lab sale solo al CREAR
 * una propuesta—, así que hacerlo por aquí no se salta ninguna notificación.
 *
 * Los ids van escritos a mano y el script comprueba uno por uno que la
 * propuesta existe, que es de quien se cree y que está donde se cree. Sin eso,
 * un id mal copiado movería el ticket de otro.
 *
 * Uso:  railway run node scripts/lab-marcar-en-desarrollo.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

/** Las 4 de Humberto, con el título esperado para poder verificarlas. */
const TICKETS = [
  ['cmue5knz700329zcs4vzan6wx', 'Permitir Poner Orden sin que el clientes este en la base de datos'],
  ['cmue7d21s003a9zcspbq15myq', 'no puedo apagar al 100% esto o modificarlos'],
  ['cmueh270u000r9wk63juob6i5', 'quitar de esta zona'],
  ['cmueh4hcd000t9wk60geidh4d', 'bug color + entrar administrad'],
];

const AUTOR = 'info@medicenache.com';

(async () => {
  const autor = await p.user.findFirst({
    where: { email: AUTOR },
    select: { id: true, fullName: true },
  });
  if (!autor) {
    console.log(`No existe el usuario ${AUTOR}. No se toca nada.`);
    return p.$disconnect();
  }

  let movidas = 0;
  for (const [id, tituloEsperado] of TICKETS) {
    const actual = await p.labProposal.findUnique({
      where: { id },
      select: { id: true, title: true, status: true, authorId: true },
    });
    if (!actual) {
      console.log(`· ${id} — NO EXISTE. Se salta.`);
      continue;
    }
    if (actual.authorId !== autor.id) {
      console.log(`· ${actual.title.trim()} — es de OTRO autor. Se salta.`);
      continue;
    }
    if (actual.title.trim() !== tituloEsperado.trim()) {
      console.log(
        `· ${id} — el título no es el esperado ("${actual.title.trim()}"). Se salta.`,
      );
      continue;
    }
    if (actual.status !== 'PENDING') {
      console.log(`· ${actual.title.trim()} — ya está en ${actual.status}. Se deja.`);
      continue;
    }

    // Condicionado al estado leído: si alguien la movió desde el panel entre
    // medias, `count` es 0 y no se le pisa la decisión.
    const r = await p.labProposal.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'IN_DEVELOPMENT',
        lastStatusChangedAt: new Date(),
        // Se deja sin `lastStatusChangedById`: no lo movió una persona desde el
        // panel, y poner ahí a alguien que no lo hizo es peor que dejarlo vacío.
      },
    });
    if (r.count === 1) {
      movidas++;
      console.log(`· ${actual.title.trim()} — PENDING → IN_DEVELOPMENT`);
    } else {
      console.log(`· ${actual.title.trim()} — cambió mientras corría esto. Sin tocar.`);
    }
  }

  console.log(`\nMovidas: ${movidas} de ${TICKETS.length}.`);

  const resumen = await p.$queryRawUnsafe(`
    SELECT status::text AS estado, COUNT(*)::int AS n
    FROM "LabProposal" WHERE "authorId" = $1 GROUP BY 1 ORDER BY 1
  `, autor.id);
  console.log(`\nCómo quedan las de ${autor.fullName}:`);
  for (const x of resumen) console.log(`  ${x.estado.padEnd(16)} ${x.n}`);

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
