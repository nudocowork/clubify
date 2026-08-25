/**
 * SOLO LECTURA — ¿qué motor de correo existe YA en producción?
 * Lista las tablas y ajustes relacionados a email/contactos para no duplicar
 * ni pisar lo que ya funciona. No escribe nada.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const tablas = await p.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND (table_name ILIKE '%email%' OR table_name ILIKE '%contact%'
           OR table_name ILIKE '%campaign%' OR table_name ILIKE '%marketing%'
           OR table_name ILIKE '%broadcast%' OR table_name ILIKE '%workflow%'
           OR table_name ILIKE '%sequence%')
    ORDER BY table_name
  `);
  console.log('=== TABLAS relacionadas a email / contactos ===');
  for (const t of tablas) {
    const [{ n }] = await p.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "${t.table_name}"`,
    );
    console.log(`  ${t.table_name.padEnd(34)} ${n} filas`);
  }

  console.log('\n=== COLUMNAS de email en WhiteLabel ===');
  const cols = await p.$queryRawUnsafe(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'WhiteLabel'
      AND (column_name ILIKE '%email%' OR column_name ILIKE '%resend%'
           OR column_name ILIKE '%smtp%' OR column_name ILIKE '%mail%')
    ORDER BY column_name
  `);
  for (const c of cols) console.log(`  ${c.column_name} (${c.data_type})`);

  console.log('\n=== SETTINGS de email / marketing (valores enmascarados) ===');
  const s = await p.$queryRawUnsafe(`
    SELECT key, LEFT(value, 60) AS muestra, LENGTH(value) AS largo
    FROM "Setting"
    WHERE key ILIKE '%email%' OR key ILIKE '%resend%' OR key ILIKE '%mail%'
       OR key ILIKE '%marketing%' OR key ILIKE '%contact%'
    ORDER BY key LIMIT 40
  `);
  if (!s.length) console.log('  (ninguno)');
  for (const r of s) {
    const m = /re_[A-Za-z0-9]/.test(r.muestra) ? '(API KEY — oculta)' : r.muestra;
    console.log(`  ${r.key} = ${m}  [${r.largo} chars]`);
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
