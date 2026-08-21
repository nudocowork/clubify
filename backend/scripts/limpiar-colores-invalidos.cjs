/**
 * SOLO LECTURA por defecto — busca colores de marca que NO son colores.
 *
 * Un texto en `primaryColor` hace que el navegador ignore el `background`: el
 * elemento se queda con fondo blanco y, si encima lleva texto blanco, queda
 * INVISIBLE. Se ve como si la pantalla no reaccionara al clic (caso real:
 * "Degodoy cocina " en la página de reservas).
 *
 * Uso:  railway run node scripts/limpiar-colores-invalidos.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const DEFECTO = '#22C55E';

(async () => {
  for (const [tabla, etiqueta] of [['Tenant', 'brandName'], ['WhiteLabel', 'name'], ['Card', 'name']]) {
    let filas = [];
    try {
      filas = await p.$queryRawUnsafe(
        `SELECT id, "${etiqueta}" AS nombre, "primaryColor" FROM "${tabla}"
          WHERE "primaryColor" IS NOT NULL AND "primaryColor" <> ''`);
    } catch (e) { console.log(`${tabla}: ${e.message.slice(0, 70)}`); continue; }
    const malos = filas.filter((f) => !HEX.test(String(f.primaryColor).trim()));
    console.log(`\n${tabla}: ${filas.length} con color · ${malos.length} inválidos`);
    for (const m of malos) {
      console.log(`   ${m.nombre} → ${JSON.stringify(m.primaryColor)}`);
      if (!APLICAR) continue;
      await p.$executeRawUnsafe(
        `UPDATE "${tabla}" SET "primaryColor" = $1 WHERE id = $2`, DEFECTO, m.id);
      console.log(`     ✓ puesto en ${DEFECTO}`);
    }
    // Blanco puro: válido pero rompe el contraste si el texto va en blanco.
    const blancos = filas.filter((f) => /^#(fff|ffffff)$/i.test(String(f.primaryColor).trim()));
    for (const b of blancos) {
      console.log(`   ⚠ ${b.nombre} usa BLANCO (${b.primaryColor}) — válido, pero el texto blanco encima no se lee. No se toca: es una decisión de marca.`);
    }
  }
  if (!APLICAR) console.log('\n(nada se escribió — usa --aplicar)');
  await p.$disconnect();
})().catch(async (e) => { console.error(e.message); await p.$disconnect(); process.exit(1); });
