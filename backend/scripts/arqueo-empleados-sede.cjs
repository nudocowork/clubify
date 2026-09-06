/**
 * SOLO LECTURA: cuántos empleados tienen sede asignada y con qué rol.
 *
 * Filtrar los pedidos por la sede del empleado es un arreglo de permisos, pero
 * también CAMBIA lo que esa gente ve mañana. Conviene saber a cuántos antes de
 * desplegarlo, no después.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const staff = await p.user.findMany({
      where: {
        role: { in: ['TENANT_STAFF', 'TENANT_ORDERS'] },
        isActive: true,
      },
      select: {
        role: true,
        locationId: true,
        tenant: { select: { name: true } },
      },
    });
    const conSede = staff.filter((u) => u.locationId);
    console.log(`empleados activos: ${staff.length}`);
    console.log(`  con sede asignada: ${conSede.length}  ← a estos les cambia`);
    console.log(`  sin sede (ven todo, y seguirán viéndolo): ${staff.length - conSede.length}`);
    const porRol = new Map();
    for (const u of conSede) {
      porRol.set(u.role, (porRol.get(u.role) || 0) + 1);
    }
    for (const [r, n] of porRol) console.log(`    ${n} · ${r}`);
    const negocios = new Set(conSede.map((u) => u.tenant?.name).filter(Boolean));
    if (negocios.size) {
      console.log(`  negocios afectados: ${[...negocios].join(', ')}`);
    }
  } finally {
    await p.$disconnect();
  }
})();
