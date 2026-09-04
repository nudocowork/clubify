/** SOLO LECTURA: en qué negocios están encendidos Club y Alianzas. */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const ts = await p.tenant.findMany({
      where: { slug: { in: ['serendipity', 'nudocowork', 'demo-clubify'] } },
      select: {
        id: true,
        name: true,
        clubEnabled: true,
        conveniosEnabled: true,
      },
    });
    for (const t of ts) {
      console.log(
        `${t.name} | ${t.id} | club:${t.clubEnabled ? 'ON' : 'OFF'} | ` +
          `alianzas:${t.conveniosEnabled ? 'ON' : 'OFF'}`,
      );
    }
  } finally {
    await p.$disconnect();
  }
})();
