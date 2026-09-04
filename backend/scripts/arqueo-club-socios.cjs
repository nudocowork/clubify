/**
 * SOLO LECTURA: qué le falta a cada socio del club y con qué enlace se ve su
 * tarjeta. Sirve para comprobar en vivo el paso de registro nuevo sin tener que
 * dar de alta a nadie.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const pases = await p.pass.findMany({
      where: { card: { clubPlanId: { not: null } } },
      select: {
        id: true,
        stampsCount: true,
        customer: {
          select: { fullName: true, email: true, birthday: true, phone: true },
        },
        card: {
          select: {
            name: true,
            stampsRequired: true,
            tenant: { select: { name: true } },
            clubPlan: { select: { name: true, beneficiosPorMes: true, unidad: true } },
          },
        },
      },

    });

    for (const s of pases) {
      const c = s.customer;
      const falta = [];
      if (!c?.fullName || !/\p{L}/u.test(c.fullName)) falta.push('nombre');
      if (!c?.email?.trim()) falta.push('correo');
      if (!c?.birthday) falta.push('cumpleaños');
      console.log(
        `\n${s.card.tenant.name} · ${s.card.clubPlan?.name} · ` +
          `${s.stampsCount}/${s.card.stampsRequired ?? '?'} ${s.card.clubPlan?.unidad}`,
      );
      console.log(`  cliente: ${c?.fullName} <${c?.email || 'sin correo'}>`);
      console.log(`  le falta: ${falta.length ? falta.join(', ') : 'nada'}`);
      console.log(`  https://app.soyclubify.com/w/${s.id}?welcome=1`);
    }
  } finally {
    await p.$disconnect();
  }
})();
