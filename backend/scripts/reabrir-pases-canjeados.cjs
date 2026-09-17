/**
 * Reabre las tarjetas de sellos y de visitas que canjear el premio dejó
 * COMPLETED para siempre.
 *
 * EL FALLO (arreglado en `src/stamps/pase-de-sellos.ts` el 2026-09-17)
 * --------------------------------------------------------------------
 * `stamps.service` escribía el estado como `completed ? 'COMPLETED' :
 * pass.status`. Al canjear, el contador bajaba, pero `pass.status` YA era
 * COMPLETED y se reescribía igual. Todo lo que filtra `status: 'ACTIVE'`
 * —envíos masivos, recurrentes, cumpleaños, refresco de diseño y de marca,
 * búsqueda por teléfono— dejaba fuera justo a los clientes que completaron y
 * volvieron. Arqueo del 2026-09-17: 56 pases de 11 negocios, 54 instalados.
 *
 * El servicio ya cura cada pase en su siguiente escaneo. Esto cura los que no
 * vuelvan a pasar por caja.
 *
 * QUÉ TOCA, y nada más
 * --------------------
 * Pases en COMPLETED de una tarjeta STAMPS o VISITS, sin club ni alianza, cuyo
 * contador está POR DEBAJO del tope de su tarjeta → ACTIVE. Solo el estado:
 * ni contadores ni `lastActivityAt` (lo usan las campañas de inactividad).
 *
 *  · Nunca un CUPÓN: ahí COMPLETED significa usado, y reabrirlo lo dejaría
 *    canjear otra vez.
 *  · Nunca una tarjeta de CLUB: su contador es un cupo que BAJA, «por debajo
 *    del tope» es su estado normal.
 *  · Nunca una tarjeta sin tope: no hay contra qué decidir.
 *
 * Aditivo, condicional e idempotente: el `where` del `updateMany` lleva la
 * condición entera, así que un pase que alguien completó entre la lectura y la
 * escritura no se toca, y correrlo dos veces no hace nada la segunda.
 *
 * Uso (desde backend/):
 *   railway run --service Postgres-Nq8w node scripts/reabrir-pases-canjeados.cjs            (simulación)
 *   railway run --service Postgres-Nq8w node scripts/reabrir-pases-canjeados.cjs --aplicar
 *
 * La simulación abre la sesión en SOLO LECTURA: aunque hubiera un fallo en este
 * archivo, no puede escribir. Solo imprime ids de negocio y totales; ningún dato
 * de clientes.
 */

/**
 * @param {any} prisma  PrismaClient (o el falso de los tests)
 * @param {{ aplicar: boolean }} opts
 * @returns {Promise<{ total: number, porNegocio: Array<{ tenantId: string, pases: number }> }>}
 */
async function reabrir(prisma, { aplicar }) {
  const tarjetas = await prisma.card.findMany({
    where: { type: { in: ['STAMPS', 'VISITS'] }, clubPlanId: null, convenioId: null },
    select: {
      id: true,
      tenantId: true,
      type: true,
      stampsRequired: true,
      visitsRequired: true,
    },
  });

  const porNegocio = new Map();
  let total = 0;
  for (const t of tarjetas) {
    const tope = t.type === 'VISITS' ? t.visitsRequired : t.stampsRequired;
    if (tope === null || tope === undefined) continue;
    const contador = t.type === 'VISITS' ? { visitsCount: { lt: tope } } : { stampsCount: { lt: tope } };
    const where = { cardId: t.id, status: 'COMPLETED', ...contador };
    const n = aplicar
      ? (await prisma.pass.updateMany({ where, data: { status: 'ACTIVE' } })).count
      : await prisma.pass.count({ where });
    if (n === 0) continue;
    total += n;
    porNegocio.set(t.tenantId, (porNegocio.get(t.tenantId) ?? 0) + n);
  }

  return {
    total,
    porNegocio: [...porNegocio.entries()]
      .map(([tenantId, pases]) => ({ tenantId, pases }))
      .sort((a, b) => b.pases - a.pases),
  };
}

module.exports = { reabrir };

if (require.main === module) {
  const APLICAR = process.argv.includes('--aplicar');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- es un .cjs que corre con node a pelo; `npm run lint` no mira scripts/
  const { PrismaClient } = require('@prisma/client');

  // Desde la máquina local solo llega la URL pública; dentro de Railway, la
  // interna. Una sola conexión: la sesión de solo lectura es por conexión, y
  // con un pool la siguiente consulta podría salir por otra que no la tiene.
  const base = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!base) {
    console.error('ERROR: no hay DATABASE_PUBLIC_URL ni DATABASE_URL en el entorno.');
    process.exit(1);
  }
  const url = base + (base.includes('?') ? '&' : '?') + 'connection_limit=1';
  const p = new PrismaClient({ datasources: { db: { url } } });

  (async () => {
    if (!APLICAR) {
      await p.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
      // Comprobarlo, no suponerlo: si la sesión no quedó en solo lectura, una
      // «simulación» no tiene por qué seguir.
      const [ro] = await p.$queryRawUnsafe('SHOW default_transaction_read_only');
      if (ro?.default_transaction_read_only !== 'on') {
        throw new Error('la sesión no quedó en solo lectura; simulación abortada');
      }
    }

    const r = await reabrir(p, { aplicar: false });
    console.log(`Pases COMPLETED por debajo del tope (sellos/visitas, sin club ni alianza): ${r.total}`);
    console.log(`Negocios: ${r.porNegocio.length}`);
    for (const x of r.porNegocio) console.log(`   ${x.tenantId}  ${x.pases}`);

    if (!APLICAR) {
      console.log('\nSIMULACIÓN. Sesión de solo lectura, nada escrito. Repite con --aplicar.');
      return;
    }

    const hecho = await reabrir(p, { aplicar: true });
    console.log(`\nReabiertos: ${hecho.total}`);
    const quedan = await reabrir(p, { aplicar: false });
    console.log(`Quedan atascados: ${quedan.total}`);
  })()
    .catch((e) => {
      console.error('ERROR:', e.message);
      process.exitCode = 1;
    })
    .finally(() => p.$disconnect());
}
