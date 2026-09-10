/**
 * Migración ADITIVA: `ProductLocation.imageUrl` y `ProductLocation.description`.
 *
 * Cierra lo que faltaba de «un producto, muchas sedes»: hasta ahora una sede
 * podía tener precio, agotado y stock propios, pero no su propia foto ni su
 * propio texto. Es la misma hamburguesa, pero la de Cabecera se sirve en cesta
 * y la de Cacique en plato, y el cliente que escanea el QR tiene que ver LA
 * SUYA.
 *
 * **Null = lo mismo que el producto**, igual que en las otras tres columnas.
 * Una sede que no personaliza nada no guarda nada y hereda sola el cambio del
 * catálogo. Por eso las dos columnas nacen nullable y sin default: crearlas con
 * `DEFAULT ''` habría convertido a las 0 filas personalizadas de hoy en filas
 * que dicen «esta sede no tiene descripción».
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` sobre columnas nullable.
 * No toca ni una fila existente y se puede correr varias veces sin efecto.
 *
 * Uso:  railway run node scripts/apply-producto-sede-foto-descripcion-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const COLUMNAS = [
  { nombre: 'imageUrl', tipo: 'TEXT' },
  { nombre: 'description', tipo: 'TEXT' },
];

(async () => {
  const existentes = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'ProductLocation'
      AND column_name IN ('imageUrl', 'description')
  `);
  const ya = new Set(existentes.map((c) => c.column_name));

  for (const c of COLUMNAS) {
    if (ya.has(c.nombre)) {
      console.log(`La columna "${c.nombre}" ya existe. Nada que hacer.`);
      continue;
    }
    console.log(`Agregando ProductLocation."${c.nombre}" (${c.tipo}, nullable)…`);
    await p.$executeRawUnsafe(
      `ALTER TABLE "ProductLocation" ADD COLUMN IF NOT EXISTS "${c.nombre}" ${c.tipo}`,
    );
  }

  const despues = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'ProductLocation'
    ORDER BY ordinal_position
  `);
  console.log('\nProductLocation tras la migración:');
  for (const c of despues) {
    console.log(
      `  ${c.column_name.padEnd(12)} ${String(c.data_type).padEnd(26)}` +
        ` nullable=${c.is_nullable} default=${c.column_default ?? '—'}`,
    );
  }

  // Comprobación de que no se rompió nada: las filas que ya existían siguen
  // diciendo lo mismo, y las dos columnas nuevas están vacías en todas ellas.
  // Si alguna saliera con valor, la migración habría inventado datos.
  const [conteo] = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS filas,
           COUNT("imageUrl")::int AS con_foto,
           COUNT("description")::int AS con_texto
    FROM "ProductLocation"
  `);
  console.log(
    `\nFilas de personalización por sede: ${conteo.filas}` +
      ` · con foto propia: ${conteo.con_foto} · con texto propio: ${conteo.con_texto}`,
  );
  if (conteo.con_foto || conteo.con_texto) {
    console.log(
      'AVISO: se esperaban 0 y 0 en una migración recién aplicada. Revisar antes de seguir.',
    );
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
