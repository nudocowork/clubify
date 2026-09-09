/**
 * Enciende SALES_TEAMS en Clubify, para que NO pierda un menú que ya usa.
 *
 * La sección «Equipos de ventas» estaba limitada a Clubify con una condición
 * escrita a mano (`clubifyOnly`). Al pasarla al interruptor por marca, si
 * nadie lo tiene encendido Clubify se queda sin una pantalla que hoy funciona
 * y con dos equipos dentro. Esto deja las cosas exactamente como estaban.
 *
 * A las demás marcas NO se les enciende: se les da cuando se decida.
 *
 * Imprime además qué módulos tiene cada marca, porque la sección «Ventas»
 * exige además REFERRALS: sin él, encender SALES_TEAMS no enseña nada.
 *
 * Uso:  railway run node scripts/encender-sales-teams-clubify.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const clubify = await p.whiteLabel.findFirst({
    where: { slug: 'clubify' },
    select: { id: true, name: true },
  });
  if (!clubify) throw new Error('no encuentro la marca clubify');

  const antes = await p.whiteLabelModule.findUnique({
    where: {
      whiteLabelId_module: { whiteLabelId: clubify.id, module: 'SALES_TEAMS' },
    },
    select: { enabled: true },
  });

  if (antes?.enabled) {
    console.log('Clubify ya lo tenía encendido. Nada que hacer.');
  } else {
    await p.whiteLabelModule.upsert({
      where: {
        whiteLabelId_module: { whiteLabelId: clubify.id, module: 'SALES_TEAMS' },
      },
      create: { whiteLabelId: clubify.id, module: 'SALES_TEAMS', enabled: true },
      update: { enabled: true },
    });
    console.log('✓ SALES_TEAMS encendido en Clubify (para no quitarle el menú).');
  }

  console.log('\nCómo queda cada marca:');
  const marcas = await p.whiteLabel.findMany({
    select: { name: true, slug: true, modules: { select: { module: true, enabled: true } } },
    orderBy: { name: 'asc' },
  });
  for (const m of marcas) {
    const on = m.modules.filter((x) => x.enabled).map((x) => x.module);
    const equipos = on.includes('SALES_TEAMS');
    const referidos = on.includes('REFERRALS');
    console.log(
      `  ${m.slug.padEnd(10)} equipos=${equipos ? 'SÍ' : 'no'} · referidos=${referidos ? 'SÍ' : 'no'}` +
        (equipos && !referidos
          ? '  ⚠ con equipos pero sin referidos: la sección «Ventas» no se pinta'
          : ''),
    );
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('Falló:', e.message);
  await p.$disconnect();
  process.exit(1);
});
