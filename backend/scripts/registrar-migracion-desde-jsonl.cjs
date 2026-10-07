/**
 * Completa la tabla "ImagenMigrada" a partir del registro LOCAL de un lote.
 *
 * Por qué (lote prod-a1, 2026-10-07): la migración aplicó 2.764 imágenes y
 * actualizó sus 4.157 referencias, pero parte de las filas de "ImagenMigrada"
 * no se guardaron («Timed out fetching a new connection from the connection
 * pool»): el registro en la base se lanzaba sin esperar y agotaba las
 * conexiones. `--revertir` lee SOLO de esa tabla, así que sin estas filas esas
 * imágenes no se podrían revertir. El JSONL local tiene todo.
 *
 * Idempotente: inserta solo lo que no está ya (misma clave, lote y modo).
 * Una conexión, una fila a la vez.
 *
 *   railway run --service backend --environment production node scripts/registrar-migracion-desde-jsonl.cjs "C:\Users\USUARIO\AppData\Local\Temp\clubify-optimizar-imagenes\prod-a1\registro.jsonl"
 *   (añade --simular para solo contar)
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const ruta = process.argv.slice(2).find((a) => !a.startsWith('--'));
const SIMULAR = process.argv.includes('--simular');
if (!ruta || !fs.existsSync(ruta)) {
  console.error('Uso: node scripts/registrar-migracion-desde-jsonl.cjs <registro.jsonl> [--simular]');
  process.exit(1);
}

const base = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || '';
const url = base + (base.includes('?') ? '&' : '?') + 'connection_limit=1';
const p = new PrismaClient({ datasources: { db: { url } } });

(async () => {
  const filas = fs
    .readFileSync(ruta, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    // Solo lo que cambió referencias: es lo único que hay que poder revertir.
    .filter((e) => e.modo === 'aplicar' && e.estado === 'aplicado' && e.urlNueva);
  // La última línea de cada clave manda (una reanudación puede repetirla).
  const porClave = new Map();
  for (const e of filas) porClave.set(`${e.clave}|${e.lote}`, e);

  let ya = 0;
  let nuevas = 0;
  for (const e of porClave.values()) {
    const existe = await p.$queryRawUnsafe(
      `SELECT 1 FROM "ImagenMigrada" WHERE "clave" = $1 AND "lote" = $2 AND "modo" = 'aplicar' LIMIT 1`,
      e.clave,
      e.lote,
    );
    if (existe.length) {
      ya++;
      continue;
    }
    nuevas++;
    if (SIMULAR) continue;
    await p.$executeRawUnsafe(
      `INSERT INTO "ImagenMigrada" ("clave","lote","modo","estado","tenantId","negocio","uso","urlAnterior","urlNueva","claveNueva","variantes","bytesAntes","bytesDespues","referencias","referenciasActualizadas","detalle","motivo")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16::jsonb,$17)`,
      e.clave, e.lote, e.modo, e.estado, e.tenantId, e.negocio, e.uso, e.urlAnterior, e.urlNueva, e.claveNueva,
      JSON.stringify(e.variantes || {}), e.bytesAntes, e.bytesDespues, e.referencias, e.referenciasActualizadas,
      JSON.stringify(e.detalle || []), e.motivo,
    );
  }
  console.log(
    `${porClave.size} aplicadas en el registro · ${ya} ya estaban en la base · ${nuevas} ${SIMULAR ? 'faltan (simulación, no se escribió nada)' : 'registradas ahora'}`,
  );
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
