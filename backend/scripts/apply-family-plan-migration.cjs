/**
 * Migración ADITIVA: plan FAMILIAR de cuponera (titular + N tarjetas enlazadas).
 *
 *  - `MembershipPlan.maxLinkedMembers` INT NOT NULL DEFAULT 0 — cuántas
 *    tarjetas ADICIONALES puede enlazar el titular. 0 = plan individual, así
 *    que todos los planes existentes quedan exactamente como estaban.
 *  - `LivingMembership.primaryMembershipId` TEXT NULL — de qué titular cuelga
 *    un enlace. Null = titular o plan individual (todas las filas existentes).
 *    Con su índice y su FK (ON DELETE SET NULL, igual que el schema).
 *
 * Idempotente: IF NOT EXISTS en todo; la FK se intenta y se ignora si ya está.
 * Hay que correrla ANTES de desplegar el backend: Prisma pide las dos columnas
 * en cada consulta de planes y membresías, y sin ellas se cae toda la cuponera.
 *
 * Uso:  railway run node scripts/apply-family-plan-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
// Pública primero: la interna (`…railway.internal`) solo resuelve dentro de
// Railway y desde un portátil el script moría sin conectar.
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

(async () => {
  console.log('MembershipPlan."maxLinkedMembers" (INT NOT NULL DEFAULT 0)…');
  await p.$executeRawUnsafe(
    `ALTER TABLE "MembershipPlan" ADD COLUMN IF NOT EXISTS "maxLinkedMembers" INTEGER NOT NULL DEFAULT 0`,
  );

  console.log('LivingMembership."primaryMembershipId" (TEXT NULL) + índice + FK…');
  await p.$executeRawUnsafe(
    `ALTER TABLE "LivingMembership" ADD COLUMN IF NOT EXISTS "primaryMembershipId" TEXT`,
  );
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "LivingMembership_primaryMembershipId_idx" ON "LivingMembership" ("primaryMembershipId")`,
  );
  // ADD CONSTRAINT no tiene IF NOT EXISTS: se intenta y, si ya existe, se sigue.
  try {
    await p.$executeRawUnsafe(
      `ALTER TABLE "LivingMembership" ADD CONSTRAINT "LivingMembership_primaryMembershipId_fkey"
         FOREIGN KEY ("primaryMembershipId") REFERENCES "LivingMembership"("id")
         ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    console.log('FK creada.');
  } catch (e) {
    if (!/already exists|ya existe/i.test(e.message)) throw e;
    console.log('FK ya existía.');
  }

  const cols = await p.$queryRawUnsafe(`
    SELECT table_name, column_name, is_nullable, column_default FROM information_schema.columns
    WHERE (table_name = 'MembershipPlan' AND column_name = 'maxLinkedMembers')
       OR (table_name = 'LivingMembership' AND column_name = 'primaryMembershipId')
    ORDER BY table_name
  `);
  console.log('Resultado:', cols);
  if (cols.length !== 2) throw new Error('No quedaron las dos columnas');

  const [{ planes }] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS planes FROM "MembershipPlan" WHERE "maxLinkedMembers" > 0`,
  );
  console.log(`Planes familiares existentes: ${planes} (lo esperado recién migrada: 0).`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
