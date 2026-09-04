/**
 * Arqueo SOLO LECTURA del estado del Club en producción.
 *
 * Existe porque "¿está el club en vivo?" no se puede responder desde el código:
 * depende de qué negocios lo tienen encendido, si hay planes creados y si
 * alguien tiene ya su tarjeta. Se ejecuta con `railway run node scripts/...`.
 *
 * No escribe nada.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const negocios = await p.tenant.findMany({
      where: { clubEnabled: true },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    });
    console.log('\n== NEGOCIOS CON CLUB ENCENDIDO ==');
    for (const t of negocios) {
      const planes = await p.clubPlan.findMany({
        where: { tenantId: t.id },
        select: {
          id: true,
          name: true,
          isActive: true,
          beneficiosPorMes: true,
          unidad: true,
          _count: { select: { membresias: true } },
        },
      });
      const cards = await p.card.count({
        where: { tenantId: t.id, clubPlanId: { not: null } },
      });
      console.log(`\n· ${t.name} (${t.slug})`);
      console.log(`  tarjetas de club: ${cards}`);
      if (!planes.length) console.log('  SIN PLANES');
      for (const pl of planes) {
        const pases = await p.pass.count({
          where: { card: { clubPlanId: pl.id } },
        });
        console.log(
          `  - ${pl.name} · ${pl.isActive ? 'activo' : 'INACTIVO'} · ` +
            `${pl.beneficiosPorMes} ${pl.unidad}/mes · ` +
            `${pl._count.membresias} socios · ${pases} pases`,
        );
      }
    }

    console.log('\n== NEGOCIOS QUE PODRÍAN QUERERLO (club apagado) ==');
    const apagados = await p.tenant.findMany({
      where: {
        clubEnabled: false,
        OR: [
          { name: { contains: 'erendipity', mode: 'insensitive' } },
          { name: { contains: 'udo', mode: 'insensitive' } },
        ],
      },
      select: { name: true, slug: true, status: true },
    });
    for (const t of apagados) console.log(`· ${t.name} (${t.slug}) ${t.status}`);

    const socios = await p.clubMembresia.count();
    const consumos = await p.clubConsumo.count();
    console.log(`\nTOTAL socios: ${socios} · consumos registrados: ${consumos}`);
  } finally {
    await p.$disconnect();
  }
})();
