/**
 * SOLO LECTURA: a cuántos clientes les tapaba los botones de instalar el paso
 * de registro cuando se aplicaba a TODAS las tarjetas y no solo al club.
 *
 * Mide lo que de verdad importa: pases de tarjetas que NO son de club cuyo
 * cliente no tiene correo o no tiene cumpleaños. Cada uno de esos es alguien
 * que abrió su tarjeta y se encontró una ficha en vez del botón.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const pases = await p.pass.findMany({
      where: { card: { clubPlanId: null } },
      select: {
        customer: { select: { fullName: true, email: true, birthday: true } },
        card: { select: { tenant: { select: { name: true } } } },
      },
    });

    const porNegocio = new Map();
    let afectados = 0;
    for (const s of pases) {
      const c = s.customer;
      const falta =
        !c?.fullName ||
        !/\p{L}/u.test(c.fullName) ||
        !c?.email?.trim() ||
        !c?.birthday;
      if (!falta) continue;
      afectados++;
      const n = s.card.tenant.name;
      porNegocio.set(n, (porNegocio.get(n) || 0) + 1);
    }

    console.log(`pases sin club: ${pases.length}`);
    console.log(`a los que se les tapaba el botón: ${afectados}`);
    const top = [...porNegocio.entries()].sort((a, b) => b[1] - a[1]);
    for (const [n, k] of top.slice(0, 12)) console.log(`  ${k}\t${n}`);
    if (top.length > 12) console.log(`  ... y ${top.length - 12} negocios más`);
  } finally {
    await p.$disconnect();
  }
})();
