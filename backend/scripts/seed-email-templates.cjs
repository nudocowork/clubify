/**
 * Seed de PLANTILLAS DE FÁBRICA del editor de correos (pestaña Plantillas).
 *
 * Escribe en la base las plantillas `isPreset: true` definidas en
 * `scripts/lib/email-presets.cjs`. Se listan para TODAS las marcas; la API no
 * deja editarlas ni borrarlas (al usarlas se duplican en la marca), así que
 * este script es el ÚNICO dueño de su contenido.
 *
 * Idempotente: la clave lógica es (isPreset, name). Si la plantilla ya existe
 * se ACTUALIZA su contenido; si no, se crea. Correrlo dos veces no duplica.
 *
 * El HTML no se maqueta aquí: sale del mismo motor que usa el editor, y la
 * verificación (data:image, preheader, alt, variedad, baja, texto plano) corre
 * ANTES de tocar la base — si algo falla, no se escribe nada.
 *
 * Uso:  railway run node scripts/seed-email-templates.cjs
 *       node scripts/seed-email-templates.cjs --dry   (solo verifica)
 */
const { PrismaClient } = require('@prisma/client');
const { renderAll } = require('./lib/email-presets.cjs');

const p = new PrismaClient();
const DRY = process.argv.includes('--dry');

(async () => {
  const listas = renderAll();
  console.log(
    `✓ ${listas.length} plantillas verificadas (data:image, preheader, alt, variedad, baja, texto plano)\n`,
  );
  if (DRY) {
    for (const t of listas) console.log(`  · ${t.name} — ${t.html.length} bytes`);
    console.log('\n--dry: no se ha escrito nada en la base.');
    await p.$disconnect();
    return;
  }

  // Las de fábrica cuelgan de la marca Clubify (el modelo exige whiteLabelId),
  // pero `isPreset: true` es lo que las hace visibles para todas las marcas.
  const clubify = await p.whiteLabel.findUnique({ where: { slug: 'clubify' }, select: { id: true } });
  if (!clubify) throw new Error('No existe la marca "clubify"; no hay dónde colgar las plantillas de fábrica.');

  for (const t of listas) {
    const existing = await p.mktEmailTemplate.findFirst({
      where: { isPreset: true, name: t.name },
      select: { id: true },
    });
    if (existing) {
      await p.mktEmailTemplate.update({
        where: { id: existing.id },
        data: { subject: t.subject, blocks: t.doc, html: t.html },
      });
      console.log(`≈ Actualizada: ${t.name}`);
    } else {
      await p.mktEmailTemplate.create({
        data: {
          whiteLabelId: clubify.id,
          name: t.name,
          subject: t.subject,
          blocks: t.doc,
          html: t.html,
          isPreset: true,
        },
      });
      console.log(`+ Creada: ${t.name}`);
    }
  }

  const total = await p.mktEmailTemplate.count({ where: { isPreset: true } });
  console.log(`\nPlantillas de fábrica en la base: ${total}`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
