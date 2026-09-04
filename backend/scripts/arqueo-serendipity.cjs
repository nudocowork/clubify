/** SOLO LECTURA: qué tarjetas y qué pases tiene Serendipity, y qué le falta a
 *  cada cliente. Para comprobar si «no se ven los botones» le pasaba a ellos. */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const t = await p.tenant.findFirst({
      where: { slug: 'serendipity' },
      select: { id: true, name: true },
    });
    const cards = await p.card.findMany({
      where: { tenantId: t.id },
      select: {
        id: true,
        name: true,
        isActive: true,
        clubPlanId: true,
        _count: { select: { passes: true } },
      },
    });
    for (const c of cards) {
      console.log(
        `tarjeta: ${c.name} · ${c.isActive ? 'activa' : 'INACTIVA'} · ` +
          `${c._count.passes} pases · club:${c.clubPlanId ? 'sí' : 'no'}`,
      );
    }
    const pases = await p.pass.findMany({
      where: { tenantId: t.id },

      select: {
        id: true,
        issuedAt: true,
        walletInstalledAt: true,
        customer: { select: { fullName: true, email: true, birthday: true } },
      },
    });
    for (const s of pases) {
      const c = s.customer;
      const falta = [];
      if (!c?.email?.trim()) falta.push('correo');
      if (!c?.birthday) falta.push('cumpleaños');
      console.log(
        `\n  ${s.id} · creado ${s.issuedAt.toISOString().slice(0, 10)} · ` +
          `instalada:${s.walletInstalledAt ? 'sí' : 'no'}`,
      );
      console.log(
        `    ${c?.fullName} · le falta: ${falta.length ? falta.join(', ') : 'nada'}`,
      );
    }
  } finally {
    await p.$disconnect();
  }
})();
