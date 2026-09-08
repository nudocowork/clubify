/**
 * SOLO LECTURA: por qué a un negocio le falla confirmar pedidos.
 *
 * Recorre lo que puede bloquear `setStatus`: el rol y la sede de cada
 * empleado, y las sedes de sus pedidos recientes. Si un empleado «solo
 * pedidos» tiene una sede y los pedidos son de OTRA, ahí está.
 */
const { PrismaClient } = require('@prisma/client');

const NOMBRE = process.argv[2] || 'Gloriosa';

(async () => {
  const p = new PrismaClient();
  try {
    const t = await p.tenant.findFirst({
      where: { name: { contains: NOMBRE, mode: 'insensitive' } },
      select: { id: true, name: true, status: true },
    });
    if (!t) return console.log(`no encuentro «${NOMBRE}»`);
    console.log(`${t.name} · ${t.status}\n`);

    const users = await p.user.findMany({
      where: { tenantId: t.id, isActive: true },
      select: {
        fullName: true,
        email: true,
        role: true,
        locationId: true,
        location: { select: { name: true } },
      },
    });
    console.log(`empleados activos: ${users.length}`);
    for (const u of users) {
      console.log(
        `  ${u.role.padEnd(14)} ${u.fullName ?? u.email} · sede: ${u.location?.name ?? 'ninguna'}`,
      );
    }

    const sedes = await p.location.findMany({
      where: { tenantId: t.id },
      select: { id: true, name: true, isActive: true },
    });
    console.log(`\nsedes: ${sedes.length}`);
    for (const s of sedes) {
      console.log(`  ${s.name}${s.isActive ? '' : ' (inactiva)'} · ${s.id}`);
    }

    const pedidos = await p.order.findMany({
      where: { tenantId: t.id },
      select: {
        code: true,
        status: true,
        createdAt: true,
        locationId: true,
        location: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
    console.log(`\núltimos pedidos: ${pedidos.length}`);
    for (const o of pedidos) {
      console.log(
        `  ${o.code} · ${o.status.padEnd(10)} · ${o.createdAt.toISOString().slice(0, 16)} · ` +
          `sede: ${o.location?.name ?? 'SIN SEDE'}`,
      );
    }
  } finally {
    await p.$disconnect();
  }
})();
