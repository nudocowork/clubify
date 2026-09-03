/**
 * El sello de un pedido lo da el NEGOCIO, no el sistema.
 *
 * Cambia el default de `Card.autoStampOnOrder` a false y lo apaga en las
 * tarjetas que ya existen.
 *
 * ── Por qué se apagan todas ────────────────────────────────────────────────
 *
 * La columna nació en `true` y nadie la tocó nunca: las 168 tarjetas activas
 * lo tenían puesto porque venía así de fábrica, no porque alguien lo eligiera.
 * Apagarlas no le quita a nadie algo que hubiera pedido.
 *
 * El caso que lo destapó (La Gloriosa): solo dan sello a quien come en el
 * local, y cada pedido del menú de domicilios les regalaba uno.
 *
 * A partir de ahora, al pasar un pedido a ENTREGADO el panel pregunta y el
 * negocio decide. La casilla se queda para quien quiera el automático de
 * vuelta, pero como opt-in.
 *
 * Aditiva e idempotente: la segunda pasada no cambia nada.
 *
 * Uso:  railway run node scripts/apply-sello-manual-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const antes = await p.$queryRawUnsafe(`
    SELECT column_default FROM information_schema.columns
    WHERE table_name = 'Card' AND column_name = 'autoStampOnOrder'
  `);
  console.log(`Default actual: ${antes[0]?.column_default ?? '(sin columna)'}`);

  await p.$executeRawUnsafe(
    `ALTER TABLE "Card" ALTER COLUMN "autoStampOnOrder" SET DEFAULT false`,
  );
  console.log('Default cambiado a false (las tarjetas NUEVAS ya no sellan solas).');

  const encendidas = await p.card.count({ where: { autoStampOnOrder: true } });
  if (encendidas === 0) {
    console.log('No queda ninguna tarjeta con sello automático. Nada que apagar.');
    return p.$disconnect();
  }

  // Se listan ANTES de apagarlas: si un negocio reclama, hay que saber a quién
  // se le cambió el comportamiento.
  const afectadas = await p.card.findMany({
    where: { autoStampOnOrder: true },
    select: { id: true, name: true, tenant: { select: { brandName: true } } },
  });
  const negocios = [...new Set(afectadas.map((c) => c.tenant.brandName))];
  console.log(`\nTarjetas con sello automático: ${afectadas.length}`);
  console.log(`Negocios afectados: ${negocios.length}`);
  for (const n of negocios.slice(0, 40)) console.log(`  · ${n}`);
  if (negocios.length > 40) console.log(`  … y ${negocios.length - 40} más`);

  const r = await p.card.updateMany({
    where: { autoStampOnOrder: true },
    data: { autoStampOnOrder: false },
  });
  console.log(`\nApagadas: ${r.count}`);

  const quedan = await p.card.count({ where: { autoStampOnOrder: true } });
  console.log(`Quedan encendidas: ${quedan} (debe ser 0)`);
  console.log(
    '\nA partir de ahora el panel PREGUNTA al pasar un pedido a entregado.',
  );

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
