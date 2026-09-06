/**
 * Enciende el aviso de pedido nuevo para TODOS los negocios.
 *
 * Decisión del dueño (2026-09-06): que un negocio se entere de sus pedidos pesa
 * más que el saldo que gasta el aviso. Se puede apagar uno a uno desde el panel
 * de super admin.
 *
 * Cambia además el DEFAULT de la columna a `true`, para que los negocios que se
 * den de alta a partir de ahora lo lleven puesto sin que nadie se acuerde.
 *
 * Idempotente: correrlo dos veces no hace nada la segunda.
 *
 *   railway run node scripts/encender-aviso-pedidos-a-todos.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const antes = await p.tenant.count({ where: { ownerOrderAlertsEnabled: true } });

  await p.$executeRawUnsafe(
    `ALTER TABLE "Tenant" ALTER COLUMN "ownerOrderAlertsEnabled" SET DEFAULT true`,
  );
  console.log('  ok · los negocios nuevos lo llevan encendido');

  const r = await p.tenant.updateMany({
    where: { ownerOrderAlertsEnabled: false },
    data: { ownerOrderAlertsEnabled: true },
  });
  console.log(`  ok · encendido en ${r.count} negocios`);

  const total = await p.tenant.count();
  const activos = await p.tenant.count({ where: { ownerOrderAlertsEnabled: true } });
  console.log(`\nantes: ${antes} · ahora: ${activos} de ${total}`);
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
