/** SOLO LECTURA — todas las tablas Mkt* y dónde vive la conexión del motor. */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const t = await p.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'Mkt%' ORDER BY 1`,
  );
  console.log('=== TABLAS Mkt* ===');
  for (const x of t) {
    const [{ n }] = await p.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "${x.table_name}"`,
    );
    console.log(`  ${x.table_name.padEnd(28)} ${n} filas`);
  }

  console.log('\n=== Settings que parezcan del motor ===');
  const s = await p.$queryRawUnsafe(
    `SELECT key, LEFT(value, 50) AS v FROM "Setting"
      WHERE key ILIKE 'mkt%' OR key ILIKE '%mkt%' OR key ILIKE '%.email%'
      ORDER BY 1 LIMIT 30`,
  );
  if (!s.length) console.log('  (ninguno)');
  for (const r of s) {
    console.log(`  ${r.key} = ${/re_[A-Za-z0-9]/.test(r.v) ? '(key oculta)' : r.v}`);
  }

  console.log('\n=== Subcuenta Grow de Sellea (posible proveedor de envío) ===');
  const g = await p.$queryRawUnsafe(
    `SELECT name, slug, "growBusinessLocationId",
            "growBusinessApiKey" IS NOT NULL AS "tieneKey"
       FROM "WhiteLabel" WHERE slug = 'sellea'`,
  );
  console.log(' ', g[0]);

  console.log('\n=== Muestra de MktWorkflow (qué acciones ejecuta) ===');
  const w = await p.$queryRawUnsafe(
    `SELECT name, status, LEFT(nodes::text, 300) AS nodes FROM "MktWorkflow" LIMIT 3`,
  );
  for (const r of w) console.log(`  ${r.name} [${r.status}] nodes=${r.nodes}`);

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
