/**
 * Migración ADITIVA: el pedido de mostrador (venta sin ficha de cliente).
 *
 *   · `Order.customerId` deja de ser obligatorio.
 *   · `Order.customerName` (texto, nullable) — a quién se le entrega cuando no
 *     hay ficha.
 *
 * POR QUÉ: para cobrarle a alguien que entra, pide y se va, había que
 * registrarlo antes en la base. Un negocio de Sellea usa los pedidos como CAJA
 * —para que la cocina los procese— y no quiere fichar a cada persona. Pedido de
 * Humberto en el Lab de Sellea (2026-09-23).
 *
 * NO TOCA NI UNA FILA EXISTENTE. Quitar el NOT NULL de una columna no cambia lo
 * que ya está guardado: los pedidos de hoy siguen con su cliente. Y añadir una
 * columna nullable tampoco.
 *
 * Idempotente: comprueba antes de cada paso y se puede correr varias veces.
 *
 * Uso:  railway run node scripts/apply-pedido-de-mostrador-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

async function columna(tabla, nombre) {
  const r = await p.$queryRawUnsafe(
    `SELECT is_nullable, data_type FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2`,
    tabla,
    nombre,
  );
  return r[0] ?? null;
}

(async () => {
  console.log('=== Pedido de mostrador — migración aditiva ===\n');

  const antes = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Order"`,
  );
  console.log(`Pedidos en la base antes de empezar: ${antes[0].n}`);

  // 1. customerId deja de ser obligatorio.
  const cid = await columna('Order', 'customerId');
  if (!cid) {
    throw new Error('No existe Order."customerId". Algo no cuadra: se aborta.');
  }
  if (cid.is_nullable === 'YES') {
    console.log('· Order."customerId" ya admite nulos.');
  } else {
    console.log('· Quitando el NOT NULL de Order."customerId"…');
    await p.$executeRawUnsafe(
      `ALTER TABLE "Order" ALTER COLUMN "customerId" DROP NOT NULL`,
    );
  }

  // 2. El nombre suelto para la cocina y la caja.
  if (await columna('Order', 'customerName')) {
    console.log('· Order."customerName" ya existe.');
  } else {
    console.log('· Añadiendo Order."customerName" (texto, nullable)…');
    await p.$executeRawUnsafe(
      `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerName" TEXT`,
    );
  }

  // ── Comprobación ────────────────────────────────────────────────────────
  console.log('\nCómo quedó:');
  for (const c of ['customerId', 'customerName']) {
    const x = await columna('Order', c);
    console.log(`  ${c.padEnd(14)} ${x ? `${x.data_type}, admite nulos: ${x.is_nullable}` : '(NO existe)'}`);
  }

  const despues = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE "customerId" IS NULL)::int AS sin_cliente
    FROM "Order"
  `);
  console.log(
    `\nPedidos: ${despues[0].total} (antes ${antes[0].n})` +
      ` | sin cliente: ${despues[0].sin_cliente}`,
  );
  if (despues[0].total !== antes[0].n) {
    console.log('  ¡OJO! El número de pedidos cambió. Revisar a mano.');
  } else {
    console.log('  Ningún pedido tocado, como tiene que ser.');
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
