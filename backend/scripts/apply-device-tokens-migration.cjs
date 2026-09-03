/**
 * Migración ADITIVA: crea la tabla `DeviceToken` (tokens de notificaciones
 * push de la app de iOS/Android).
 *
 * Aditiva e idempotente: `CREATE TABLE IF NOT EXISTS` + índices con
 * `IF NOT EXISTS`. No toca ninguna tabla existente y se puede correr varias
 * veces sin efecto.
 *
 * Por qué a mano y no con `prisma db push`: producción tiene índices únicos
 * parciales que Prisma no sabe expresar, y db push BORRA lo que no está en el
 * schema. Ver docs/ESTADO-PRODUCCION.md.
 *
 * Uso:  railway run node scripts/apply-device-tokens-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const existe = await p.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'DeviceToken'
  `);

  if (existe.length) {
    console.log('La tabla "DeviceToken" ya existe. No hay nada que crear.');
  } else {
    console.log('Creando tabla "DeviceToken"…');
    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "DeviceToken" (
        "id"         TEXT NOT NULL,
        "userId"     TEXT NOT NULL,
        "platform"   TEXT NOT NULL,
        "token"      TEXT NOT NULL,
        "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
      )
    `);
  }

  // Único por TOKEN: el registro hace upsert sobre él para que un aparato que
  // cambia de dueño deje de recibir lo del anterior.
  await p.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "DeviceToken_token_key" ON "DeviceToken"("token")`,
  );
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "DeviceToken_userId_idx" ON "DeviceToken"("userId")`,
  );

  // La FK va aparte y tolerando que ya exista: Postgres no admite
  // `ADD CONSTRAINT IF NOT EXISTS`.
  const fk = await p.$queryRawUnsafe(`
    SELECT conname FROM pg_constraint WHERE conname = 'DeviceToken_userId_fkey'
  `);
  if (!fk.length) {
    console.log('Agregando la clave foránea a "User"…');
    await p.$executeRawUnsafe(`
      ALTER TABLE "DeviceToken"
        ADD CONSTRAINT "DeviceToken_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    `);
  }

  const cols = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'DeviceToken' ORDER BY ordinal_position
  `);
  console.log('\nColumnas de DeviceToken:');
  for (const c of cols) {
    console.log(`  ${c.column_name.padEnd(12)} ${c.data_type} ${c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
  }

  const idx = await p.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'DeviceToken' ORDER BY indexname`,
  );
  console.log('Índices:', idx.map((i) => i.indexname).join(', '));

  const n = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "DeviceToken"`);
  console.log(`Tokens registrados: ${n[0].n}`);

  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
