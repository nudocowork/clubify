/**
 * Alianzas — portal del aliado y unicidad por documento.
 *
 * Aditivo sobre `apply-convenios-migration.cjs`, que ya creó las tablas. Añade:
 *   · ConvenioCupon.activoAliado — la segunda llave del doble interruptor.
 *   · Convenio.aliadoToken       — el enlace del portal del aliado.
 *   · índice único PARCIAL (convenioId, documento) — una cédula, una tarjeta.
 *
 * SQL crudo y aditivo, no `prisma db push`: producción tiene índices únicos
 * parciales que Prisma no sabe expresar y un push los borra. De hecho el índice
 * de documento que crea este script es uno de ellos. Modelo copiado de
 * `apply-club-migration.cjs`.
 *
 * Idempotente: correrlo dos veces no hace nada la segunda.
 *
 *   railway run node scripts/apply-alianzas-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const PASOS = [
  [
    'ConvenioCupon.activoAliado',
    // DEFAULT true: los cupones que ya existan quedan encendidos por parte del
    // aliado. Nacer en false apagaría en silencio convenios en marcha, y nadie
    // entendería por qué dejaron de canjearse.
    `ALTER TABLE "ConvenioCupon"
       ADD COLUMN IF NOT EXISTS "activoAliado" BOOLEAN NOT NULL DEFAULT true`,
  ],
  [
    'Convenio.aliadoToken',
    // Nullable a propósito: se rellena la primera vez que el negocio abre el
    // portal. Rellenarlo aquí para todos generaría enlaces con mando que nadie
    // pidió, y bastaría una fuga del volcado para tenerlos todos.
    `ALTER TABLE "Convenio" ADD COLUMN IF NOT EXISTS "aliadoToken" TEXT`,
  ],
  [
    'índice Convenio.aliadoToken (único)',
    // Único pero parcial: varios convenios sin portal abierto conviven con
    // aliadoToken NULL, y un único normal sobre NULL no colisiona en Postgres,
    // pero el parcial deja explícito que los NULL no participan.
    `CREATE UNIQUE INDEX IF NOT EXISTS "Convenio_aliadoToken_key"
       ON "Convenio"("aliadoToken") WHERE "aliadoToken" IS NOT NULL`,
  ],
  [
    'índice ConvenioTarjeta (documento único por convenio)',
    // LA RED ANTIABUSO. Sin él, "¿ya hay alguien con esta cédula?" es
    // leer-decidir-escribir y dos activaciones simultáneas pasan las dos.
    // Parcial porque `documento` es nullable en el esquema y las tarjetas sin
    // documento no deben estorbarse entre ellas.
    `CREATE UNIQUE INDEX IF NOT EXISTS "ConvenioTarjeta_convenioId_documento_key"
       ON "ConvenioTarjeta"("convenioId","documento") WHERE "documento" IS NOT NULL`,
  ],
  [
    'índice ConvenioTarjeta (búsqueda por documento)',
    `CREATE INDEX IF NOT EXISTS "ConvenioTarjeta_convenioId_documento_idx"
       ON "ConvenioTarjeta"("convenioId","documento")`,
  ],
];

(async () => {
  // El índice único parcial revienta si ya hay documentos repetidos. Mirarlo
  // ANTES para poder decir cuáles son: el error de Postgres solo dice que
  // falló, y a mano no se sabe por dónde empezar a limpiar.
  const repes = await p.$queryRawUnsafe(
    `SELECT "convenioId", "documento", COUNT(*)::int AS n
       FROM "ConvenioTarjeta"
      WHERE "documento" IS NOT NULL
      GROUP BY "convenioId", "documento"
     HAVING COUNT(*) > 1`,
  );
  if (repes.length > 0) {
    console.error('\nHay documentos repetidos dentro de un mismo convenio:');
    for (const r of repes) {
      console.error(`  convenio ${r.convenioId} · documento ${r.documento} · ${r.n} tarjetas`);
    }
    throw new Error(
      'resuelve los duplicados antes de crear el índice único (deja una tarjeta por documento)',
    );
  }

  for (const [nombre, sql] of PASOS) {
    // Una sentencia por entrada, sin trocear: los bloques `DO $$ ... $$` llevan
    // `;` dentro y partirlos por ahí los deja sin cerrar.
    await p.$executeRawUnsafe(sql);
    console.log(`  ok · ${nombre}`);
  }

  const cols = await p.$queryRawUnsafe(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE (table_name='ConvenioCupon' AND column_name='activoAliado')
         OR (table_name='Convenio'      AND column_name='aliadoToken')`,
  );
  if (cols.length !== 2) {
    throw new Error(`esperaba 2 columnas nuevas, hay ${cols.length}`);
  }
  const idx = await p.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes
      WHERE indexname IN ('Convenio_aliadoToken_key',
                          'ConvenioTarjeta_convenioId_documento_key')`,
  );
  if (idx.length !== 2) {
    throw new Error(`esperaba 2 índices, hay ${idx.length}`);
  }

  const convenios = await p.convenio.count();
  const tarjetas = await p.convenioTarjeta.count();
  console.log(
    `\nlisto · 2 columnas + 3 índices · convenios: ${convenios} · tarjetas: ${tarjetas}`,
  );
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
