/**
 * Migración ADITIVA de la Tarjeta Informativa (CardType.INFO).
 *
 * Tres cosas, todas aditivas e idempotentes:
 *
 *   1. `CardType` gana el valor 'INFO'.
 *   2. `Tenant.infoCardEnabled` (boolean, default false) — el interruptor por
 *      negocio, apagado para los ~136 que hay.
 *   3. `Pass.revokedAt` / `Pass.revokedBy` — la evidencia de una revocación.
 *
 * LA TRAMPA DEL ENUM, que es por lo que esto es un script y no una línea:
 * en PostgreSQL un valor de enum recién añadido NO se puede USAR dentro de la
 * misma transacción que lo creó. `ALTER TYPE ... ADD VALUE` tiene que estar
 * commiteado antes de que nadie inserte una fila con él. Por eso el ALTER va
 * suelto y fuera de cualquier bloque, y por eso este script hay que correrlo
 * ANTES de desplegar el backend, no a la vez.
 *
 * `ADD VALUE IF NOT EXISTS` y `ADD COLUMN IF NOT EXISTS` hacen que correrlo dos
 * veces no tenga efecto. No toca ni una fila existente.
 *
 * Uso:
 *   cd backend
 *   railway run --service Postgres-Nq8w node scripts/apply-tarjeta-informativa-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const valorDelEnum = async () =>
  p.$queryRawUnsafe(`
    SELECT e.enumlabel FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CardType' AND e.enumlabel = 'INFO'
  `);

const columna = async (tabla, col) =>
  p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = $1 AND column_name = $2
  `, tabla, col);

(async () => {
  // ---- 1. El valor del enum -------------------------------------------------
  if ((await valorDelEnum()).length) {
    console.log("CardType.'INFO' ya existe.");
  } else {
    console.log("Agregando CardType.'INFO'…");
    // Suelto y sin transacción a propósito: ver la cabecera.
    await p.$executeRawUnsafe(`ALTER TYPE "CardType" ADD VALUE IF NOT EXISTS 'INFO'`);
    console.log((await valorDelEnum()).length ? '  → creado.' : '  → NO se creó.');
  }

  // ---- 2. El interruptor por negocio ---------------------------------------
  if ((await columna('Tenant', 'infoCardEnabled')).length) {
    console.log('Tenant."infoCardEnabled" ya existe.');
  } else {
    console.log('Agregando Tenant."infoCardEnabled" (boolean, default false)…');
    await p.$executeRawUnsafe(
      `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "infoCardEnabled" BOOLEAN NOT NULL DEFAULT false`,
    );
  }

  // ---- 3. La evidencia de la revocación ------------------------------------
  for (const [col, tipo] of [['revokedAt', 'TIMESTAMP(3)'], ['revokedBy', 'TEXT']]) {
    if ((await columna('Pass', col)).length) {
      console.log(`Pass."${col}" ya existe.`);
    } else {
      console.log(`Agregando Pass."${col}" (${tipo}, nullable)…`);
      await p.$executeRawUnsafe(
        `ALTER TABLE "Pass" ADD COLUMN IF NOT EXISTS "${col}" ${tipo}`,
      );
    }
  }

  // ---- Comprobación: que quedó como decimos y que no se movió nada ---------
  console.log('\nEstado tras la migración:');
  console.log("  CardType.'INFO':", (await valorDelEnum()).length ? 'sí' : 'NO');
  for (const [tabla, col] of [
    ['Tenant', 'infoCardEnabled'],
    ['Pass', 'revokedAt'],
    ['Pass', 'revokedBy'],
  ]) {
    const [c] = await columna(tabla, col);
    console.log(`  ${tabla}."${col}":`, c ? `${c.data_type} nullable=${c.is_nullable}` : 'NO EXISTE');
  }

  // Nadie debe quedar con la función encendida sin pedirlo, y ningún pase vivo
  // debe salir de aquí marcado como revocado.
  const [conteos] = await p.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*) FROM "Tenant")::int                                  AS negocios,
      (SELECT COUNT(*) FROM "Tenant" WHERE "infoCardEnabled")::int          AS con_la_funcion,
      (SELECT COUNT(*) FROM "Card" WHERE "type" = 'INFO')::int              AS tarjetas_info,
      (SELECT COUNT(*) FROM "Pass" WHERE "revokedAt" IS NOT NULL)::int      AS pases_revocados
  `);
  console.log(
    `\n  ${conteos.negocios} negocios · ${conteos.con_la_funcion} con la función encendida` +
      ` · ${conteos.tarjetas_info} tarjetas INFO · ${conteos.pases_revocados} pases revocados`,
  );
  if (conteos.con_la_funcion !== 0 || conteos.pases_revocados !== 0) {
    console.log('  ⚠ Se esperaba 0 y 0 en una primera aplicación. Míralo antes de desplegar.');
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
