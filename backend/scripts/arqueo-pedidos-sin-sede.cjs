/** SOLO LECTURA: cuántos pedidos no tienen sede asignada. */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const sin = await p.order.count({ where: { locationId: null } });
    const con = await p.order.count({ where: { locationId: { not: null } } });
    console.log(`pedidos SIN sede: ${sin} · CON sede: ${con}`);
    const staff = await p.user.count({
      where: { role: 'TENANT_ORDERS', locationId: { not: null }, isActive: true },
    });
    console.log(`empleados «solo pedidos» con sede: ${staff}`);
  } finally {
    await p.$disconnect();
  }
})();
