/**
 * SOLO LECTURA — estructura de las tablas del motor de Email Marketing
 * (MktContact / MktWorkflow) y dónde guarda su conexión de envío.
 * No escribe nada.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const describe = async (tabla) => {
  const cols = await p.$queryRawUnsafe(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_name = $1 ORDER BY ordinal_position`,
    tabla,
  );
  if (!cols.length) return console.log(`\n=== ${tabla}: no existe ===`);
  console.log(`\n=== ${tabla} ===`);
  for (const c of cols) {
    console.log(
      `  ${c.column_name.padEnd(24)} ${c.data_type.padEnd(26)}` +
        `${c.is_nullable === 'YES' ? 'null' : 'NOT NULL'}` +
        `${c.column_default ? '  def=' + String(c.column_default).slice(0, 30) : ''}`,
    );
  }
  const idx = await p.$queryRawUnsafe(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1`,
    tabla,
  );
  for (const i of idx) console.log(`  idx: ${i.indexdef.replace(/^CREATE /, '')}`);
};

(async () => {
  for (const t of ['MktContact', 'MktWorkflow', 'MktWorkflowFolder']) {
    await describe(t);
  }

  // ¿Dónde vive la API key del motor? Busca en cualquier tabla una columna
  // que parezca guardar credenciales de envío.
  console.log('\n=== Columnas candidatas a guardar la conexión de envío ===');
  const cand = await p.$queryRawUnsafe(`
    SELECT table_name, column_name, data_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (column_name ILIKE '%apikey%' OR column_name ILIKE '%api_key%'
            OR column_name ILIKE '%resend%' OR column_name ILIKE '%smtp%'
            OR column_name ILIKE '%sender%' OR column_name ILIKE '%fromemail%'
            OR column_name ILIKE '%mailconfig%' OR column_name ILIKE '%emailconfig%')
     ORDER BY table_name, column_name
  `);
  for (const c of cand) {
    console.log(`  ${c.table_name}.${c.column_name} (${c.data_type})`);
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
