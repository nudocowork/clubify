/**
 * Migración ADITIVA: crea la tabla "ImagenMigrada", el registro de la
 * migración de imágenes (`scripts/optimizar-imagenes-existentes.cjs`).
 *
 * Por qué una tabla y no solo el JSONL local: el JSONL vive en la máquina de
 * quien corrió el lote. Si mañana hay que revertir desde la otra máquina, la
 * URL anterior de cada referencia tiene que estar en la base. Una fila por
 * recurso y corrida (simular no escribe aquí): clave, lote, URL anterior y
 * nueva, las referencias tocadas (para revertir EXACTAMENTE esas) y los pesos.
 *
 * No está en schema.prisma a propósito: solo la usa el script por SQL crudo,
 * y meterla en el schema no aporta nada y obligaría a regenerar el cliente.
 * Aditiva e idempotente: `CREATE TABLE IF NOT EXISTS` + índices `IF NOT
 * EXISTS`. No toca ninguna tabla existente. Se puede correr varias veces.
 *
 * Uso:  railway run node scripts/apply-imagen-migrada-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
// La URL PÚBLICA primero: la interna (`…railway.internal`) solo resuelve
// dentro de Railway. (Mismo criterio que apply-email-config-migration.cjs.)
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

(async () => {
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ImagenMigrada" (
      "id"                      BIGSERIAL PRIMARY KEY,
      "clave"                   TEXT NOT NULL,
      "lote"                    TEXT NOT NULL,
      "modo"                    TEXT NOT NULL,
      "estado"                  TEXT NOT NULL,
      "tenantId"                TEXT,
      "negocio"                 TEXT,
      "uso"                     TEXT NOT NULL,
      "urlAnterior"             TEXT NOT NULL,
      "urlNueva"                TEXT,
      "claveNueva"              TEXT,
      "variantes"               JSONB NOT NULL DEFAULT '{}'::jsonb,
      "bytesAntes"              INTEGER,
      "bytesDespues"            INTEGER,
      "referencias"             INTEGER NOT NULL DEFAULT 0,
      "referenciasActualizadas" INTEGER NOT NULL DEFAULT 0,
      "detalle"                 JSONB NOT NULL DEFAULT '[]'::jsonb,
      "motivo"                  TEXT,
      "creadoEn"                TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ImagenMigrada_lote_idx" ON "ImagenMigrada" ("lote", "modo", "estado")`,
  );
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ImagenMigrada_tenant_idx" ON "ImagenMigrada" ("tenantId")`,
  );
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ImagenMigrada_urlNueva_idx" ON "ImagenMigrada" ("urlNueva")`,
  );
  const cols = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'ImagenMigrada' ORDER BY ordinal_position
  `);
  const n = await p.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "ImagenMigrada"`);
  console.log(`"ImagenMigrada" lista: ${cols.length} columnas, ${n[0].n} filas.`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
