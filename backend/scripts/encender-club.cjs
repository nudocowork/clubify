/**
 * Enciende (o apaga) la Tarjeta de Club para un negocio.
 *
 * El módulo arranca APAGADO para todos: encenderlo le cambia el menú del panel
 * al negocio, y eso se decide uno por uno. Lo mismo que alianzas y que las
 * cartas por sede.
 *
 *   railway run node scripts/encender-club.cjs                 → lista los que lo tienen
 *   railway run node scripts/encender-club.cjs "Nudo"          → busca por nombre
 *   railway run node scripts/encender-club.cjs "Nudo" --on     → lo enciende
 *   railway run node scripts/encender-club.cjs "Nudo" --off    → lo apaga
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const args = process.argv.slice(2);
  const encender = args.includes('--on');
  const apagar = args.includes('--off');
  const busca = args.find((a) => !a.startsWith('--'));

  if (!busca) {
    const puestos = await p.tenant.findMany({
      where: { clubEnabled: true },
      select: { id: true, name: true, brandName: true },
      orderBy: { name: 'asc' },
    });
    console.log(
      puestos.length
        ? `Con la Tarjeta de Club encendida (${puestos.length}):`
        : 'Ningún negocio la tiene encendida todavía.',
    );
    for (const t of puestos) console.log(`  · ${t.brandName || t.name}  [${t.id}]`);
    await p.$disconnect();
    return;
  }

  const encontrados = await p.tenant.findMany({
    where: {
      OR: [
        { name: { contains: busca, mode: 'insensitive' } },
        { brandName: { contains: busca, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, brandName: true, clubEnabled: true, status: true },
    take: 20,
  });

  if (!encontrados.length) {
    console.log(`Ningún negocio con «${busca}» en el nombre.`);
    await p.$disconnect();
    return;
  }

  // Con varios resultados NO se toca nada: apagarle o encenderle el módulo al
  // negocio equivocado se ve en su panel al instante.
  if ((encender || apagar) && encontrados.length > 1) {
    console.log(`«${busca}» encaja con ${encontrados.length} negocios. Afina la búsqueda:`);
    for (const t of encontrados) {
      console.log(`  · ${t.brandName || t.name}  [${t.id}]  club=${t.clubEnabled}`);
    }
    await p.$disconnect();
    return;
  }

  if (!encender && !apagar) {
    for (const t of encontrados) {
      console.log(
        `  · ${t.brandName || t.name}  [${t.id}]  club=${t.clubEnabled}  estado=${t.status}`,
      );
    }
    await p.$disconnect();
    return;
  }

  const t = encontrados[0];
  await p.tenant.update({
    where: { id: t.id },
    data: { clubEnabled: encender },
  });
  console.log(
    `${t.brandName || t.name}: Tarjeta de Club ${encender ? 'ENCENDIDA' : 'apagada'}.`,
  );
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
