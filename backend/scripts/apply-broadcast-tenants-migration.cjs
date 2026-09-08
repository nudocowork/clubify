/**
 * Migración ADITIVA: agrega el valor `TENANTS` al enum `BroadcastAudience`.
 *
 * Hasta ahora la difusión interna solo llegaba al panel de afiliados: las
 * cuatro audiencias eran la red de ventas. `TENANTS` es la audiencia de los
 * NEGOCIOS, para anunciarles novedades del producto en su propio panel.
 *
 * Aditiva e idempotente: `ADD VALUE IF NOT EXISTS` sobre un enum. No toca
 * ninguna fila y se puede correr varias veces sin efecto. Las piezas que ya
 * existen conservan su audiencia — `ALL` sigue queriendo decir «todos los
 * afiliados» y no se le abre a nadie más.
 *
 * Uso:  railway run node scripts/apply-broadcast-tenants-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const VALORES = `
  SELECT e.enumlabel AS valor
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'BroadcastAudience'
  ORDER BY e.enumsortorder
`;

(async () => {
  const antes = await p.$queryRawUnsafe(VALORES);
  console.log('Audiencias actuales:', antes.map((r) => r.valor).join(', '));

  if (antes.some((r) => r.valor === 'TENANTS')) {
    console.log('«TENANTS» ya existe. No hay nada que hacer.');
    return p.$disconnect();
  }

  console.log('Agregando «TENANTS»…');
  // Fuera de transacción a propósito: Postgres no deja usar un valor de enum
  // recién creado dentro de la misma transacción que lo creó.
  await p.$executeRawUnsafe(
    `ALTER TYPE "BroadcastAudience" ADD VALUE IF NOT EXISTS 'TENANTS'`,
  );

  const despues = await p.$queryRawUnsafe(VALORES);
  console.log('Audiencias tras la migración:', despues.map((r) => r.valor).join(', '));

  // Comprobación: ninguna pieza existente cambió de audiencia.
  const piezas = await p.$queryRawUnsafe(
    `SELECT audience, COUNT(*)::int AS n FROM "Broadcast" GROUP BY audience ORDER BY audience`,
  );
  console.log('\nPiezas por audiencia:');
  for (const f of piezas) console.log(`  ${f.audience}: ${f.n}`);

  await p.$disconnect();
})().catch(async (e) => {
  console.error('Falló:', e.message);
  await p.$disconnect();
  process.exit(1);
});
