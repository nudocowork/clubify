/**
 * Migración ADITIVA: agrega `Tenant.metaPixelId` (texto opcional).
 *
 * Es el píxel de Meta DEL NEGOCIO, el que se dispara en su menú público. No
 * tiene nada que ver con `WhiteLabel.metaPixelId`, que mide la landing de la
 * marca: aquel es tráfico de Sellea/Clubify vendiendo la plataforma, y este es
 * el de la agencia del restaurante vendiendo sus bubble teas. Mezclarlos sería
 * mandarle las conversiones de un cliente a la cuenta publicitaria de otro.
 *
 * Lo pidió la agencia de Quipao (3 sedes, un solo menú) el 2026-09-14.
 *
 * Aditiva e idempotente (`ADD COLUMN IF NOT EXISTS` sobre una columna nullable):
 * no toca datos y se puede correr varias veces. Nunca `prisma db push`.
 *
 * Uso: railway run --service Postgres-Nq8w node scripts/apply-tenant-meta-pixel-migration.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const p = new PrismaClient({ datasources: { db: { url } } });

  const ya = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'Tenant' AND column_name = 'metaPixelId'
  `);
  if (ya.length) {
    console.log('La columna "metaPixelId" ya existe:', ya[0]);
    await p.$disconnect();
    return;
  }

  const DDL = `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "metaPixelId" TEXT`;
  if (!APLICAR) {
    console.log('-- DRY RUN. Se ejecutaría:\n   ' + DDL + ';');
    await p.$disconnect();
    return;
  }

  await p.$executeRawUnsafe(DDL);
  const despues = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'Tenant' AND column_name = 'metaPixelId'
  `);
  const n = await p.tenant.count();
  console.log('listo:', despues[0], `· ${n} negocios, ninguno modificado (la columna nace en NULL)`);
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
