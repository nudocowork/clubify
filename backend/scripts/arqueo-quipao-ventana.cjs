/**
 * SOLO LECTURA: ¿qué siguió funcionando mientras la cuenta estaba pausada?
 *
 * Quipao quedó SUSPENDED el 2026-09-07 03:00 y volvió a ACTIVE a las 21:48
 * con el cobro. La pregunta es qué pasó en medio: si entraron pedidos, si se
 * sellaron tarjetas y si la gente pudo entrar al panel. Eso decide si «no se
 * suspendió» es que la suspensión no se aplicó, o que la suspensión casi no
 * hace nada.
 */
const { PrismaClient } = require('@prisma/client');

const ID = '2f224b27-934f-4858-8e86-a26638f8a39d';
const DESDE = new Date('2026-09-07T03:00:00.000Z');
const HASTA = new Date('2026-09-07T21:48:00.000Z');
const f = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');

(async () => {
  const p = new PrismaClient();
  const rango = { gte: DESDE, lte: HASTA };
  try {
    console.log(`Ventana pausada: ${f(DESDE)} → ${f(HASTA)}  (UTC)\n`);

    const pedidos = await p.order.findMany({
      where: { tenantId: ID, createdAt: rango },
      select: { code: true, createdAt: true, status: true, total: true },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`pedidos entrados con la cuenta pausada: ${pedidos.length}`);
    for (const o of pedidos) {
      console.log(`  ${f(o.createdAt)}  ${o.code}  ${o.status}  ${o.total}`);
    }

    const sellos = await p.stamp
      .count({ where: { tenantId: ID, createdAt: rango } })
      .catch(() => null);
    console.log(`\nsellos puestos con la cuenta pausada: ${sellos ?? '(no se pudo contar)'}`);

    const pases = await p.pass
      .count({ where: { tenantId: ID, createdAt: rango } })
      .catch(() => null);
    console.log(`tarjetas nuevas emitidas: ${pases ?? '(no se pudo contar)'}`);

    const logins = await p.auditLog.count({
      where: { tenantId: ID, action: 'auth.login', createdAt: rango },
    });
    console.log(`inicios de sesión al panel: ${logins}`);

    // Y el estado del tenant, por si alguien lo reactivó a mano en medio.
    const cambios = await p.auditLog.findMany({
      where: { tenantId: ID, createdAt: rango },
      select: { createdAt: true, action: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`\ntodo lo auditado en la ventana (${cambios.length}):`);
    for (const c of cambios) {
      console.log(`  ${f(c.createdAt)}  ${c.action}  ${JSON.stringify(c.metadata ?? {})}`);
    }
  } finally {
    await p.$disconnect();
  }
})();
