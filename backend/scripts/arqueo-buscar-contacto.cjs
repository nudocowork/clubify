/** SOLO LECTURA: a qué número le estamos escribiendo por un correo dado. */
const { PrismaClient } = require('@prisma/client');

const AGUJA = process.argv[2];

(async () => {
  if (!AGUJA) return console.log('uso: node scripts/arqueo-buscar-contacto.cjs <correo o texto>');
  const p = new PrismaClient();
  try {
    const users = await p.user.findMany({
      where: { email: { contains: AGUJA, mode: 'insensitive' } },
      select: {
        fullName: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        tenant: { select: { name: true } },
      },
    });
    console.log(`usuarios: ${users.length}`);
    for (const u of users) {
      console.log(
        `  ${u.fullName ?? '—'} · ${u.email} · ${u.phone ?? 'sin teléfono'} · ` +
          `${u.role}${u.isActive ? '' : ' (inactivo)'} · ${u.tenant?.name ?? 'sin negocio'}`,
      );
    }

    const tenants = await p.tenant.findMany({
      where: {
        OR: [
          { email: { contains: AGUJA, mode: 'insensitive' } },
          { name: { contains: AGUJA, mode: 'insensitive' } },
        ],
      },
      select: { name: true, email: true, phone: true, whatsappPhone: true },
    });
    console.log(`\nnegocios: ${tenants.length}`);
    for (const t of tenants) {
      console.log(
        `  ${t.name} · ${t.email ?? '—'} · ${t.whatsappPhone ?? t.phone ?? 'sin teléfono'}`,
      );
    }

    // Los mensajes que le hemos mandado, para ver por qué vías le llegan.
    const tel = users.map((u) => u.phone).filter(Boolean);
    if (tel.length) {
      const logs = await p.messageLog.findMany({
        where: { toPhone: { in: tel } },
        select: { createdAt: true, channel: true, templateId: true, feature: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      console.log(`\nmensajes enviados a ${tel.join(', ')}: ${logs.length}`);
      for (const m of logs) {
        console.log(
          `  ${m.createdAt.toISOString().slice(0, 16)} · ${m.channel} · ` +
            `${m.templateId ?? '—'} · ${m.feature ?? '—'} · ${m.status}`,
        );
      }
    }
  } finally {
    await p.$disconnect();
  }
})();
