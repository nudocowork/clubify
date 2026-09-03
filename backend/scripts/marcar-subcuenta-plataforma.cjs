/**
 * Marca UNA subcuenta de Grow Business como la predeterminada de la plataforma.
 *
 * Para qué: los correos de Clubify (y de los negocios sin marca) salen por la
 * subcuenta de la marca, pero la marca `clubify` no tiene una vinculada. Este
 * flag le da destino al fallback de `BrandEmailService.platformTransport`.
 *
 * Por qué el flag y no vincular la subcuenta a la marca: `brandGrowCreds` lo
 * consumen también reseñas, pedidos, reservas y automatizaciones. Vincularla
 * abriría un canal de SMS a clientes finales de 74 negocios que hoy no lo
 * tienen — mucho más de lo que se pidió. `isDefault` no lo lee ninguna otra
 * ruta: solo ordena la lista del panel.
 *
 * Uso:  railway run node scripts/marcar-subcuenta-plataforma.cjs <locationId> [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const LOCATION = process.argv[2];
const APLICAR = process.argv.includes('--aplicar');

(async () => {
  if (!LOCATION) {
    console.log('Falta el locationId.');
    return p.$disconnect();
  }
  const antes = await p.$queryRawUnsafe(
    `SELECT id, name, "locationId", purpose, "isDefault"
       FROM "GrowBusinessAccount" WHERE "deletedAt" IS NULL ORDER BY name`,
  );
  console.log('ANTES:');
  for (const a of antes) {
    console.log(`  ${a.name.padEnd(24)} ${a.locationId}  default=${a.isDefault ? 'SÍ' : 'no'}`);
  }
  const obj = antes.find((a) => a.locationId === LOCATION);
  if (!obj) {
    console.log(`\nNo hay subcuenta activa con locationId ${LOCATION}.`);
    return p.$disconnect();
  }
  if (obj.isDefault) {
    console.log(`\n"${obj.name}" ya es la predeterminada. Nada que hacer.`);
    return p.$disconnect();
  }
  if (!APLICAR) {
    console.log(`\n[simulación] marcaría "${obj.name}" como predeterminada.`);
    console.log('Repetir con --aplicar para escribirlo.');
    return p.$disconnect();
  }
  await p.$executeRawUnsafe(
    `UPDATE "GrowBusinessAccount" SET "isDefault" = false
      WHERE "isDefault" = true AND "deletedAt" IS NULL AND id <> $1`,
    obj.id,
  );
  await p.$executeRawUnsafe(
    `UPDATE "GrowBusinessAccount" SET "isDefault" = true WHERE id = $1`,
    obj.id,
  );
  const despues = await p.$queryRawUnsafe(
    `SELECT name, "locationId", "isDefault" FROM "GrowBusinessAccount"
      WHERE "deletedAt" IS NULL ORDER BY name`,
  );
  console.log('\nDESPUÉS:');
  for (const a of despues) {
    console.log(`  ${a.name.padEnd(24)} ${a.locationId}  default=${a.isDefault ? 'SÍ' : 'no'}`);
  }
  await p.$disconnect();
})().catch(async (e) => { console.error(e.message); await p.$disconnect(); process.exit(1); });
