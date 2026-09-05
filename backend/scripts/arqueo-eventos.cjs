/** SOLO LECTURA: eventos publicados y su enlace de invitación. */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const eventos = await p.reservationEvent.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        capacity: true,
        date: true,
        tenant: { select: { name: true } },
        _count: { select: { attendees: true } },
      },
      orderBy: { date: 'desc' },
      take: 10,
    });
    for (const e of eventos) {
      console.log(
        `\n${e.tenant.name} · ${e.name} · ${e.status} · ` +
          `${e._count.attendees}/${e.capacity} · ${e.date.toISOString().slice(0, 10)}`,
      );
      console.log(`  https://app.soyclubify.com/e/${e.id}`);
    }
    if (!eventos.length) console.log('no hay eventos');
  } finally {
    await p.$disconnect();
  }
})();
