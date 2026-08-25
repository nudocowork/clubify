/**
 * Edita la nota de un pago manual ya registrado.
 *
 * Existe porque el panel todavía no deja editarla: una vez guardado el pago,
 * la nota queda congelada y corregir una fecha mal escrita obliga a esto.
 *
 * Uso:
 *   railway run node scripts/editar-nota-pago-manual.cjs <idPago> "texto" [--aplicar]
 *
 * Los saltos de línea se escriben como la secuencia barra-n. Pasar un salto
 * real como argumento lo parte en varios y se pierde todo menos la primera
 * línea (pasó en el primer intento).
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const libres = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [id, texto] = libres;
const APLICAR = process.argv.includes('--aplicar');

(async () => {
  if (!id || texto == null) {
    console.log('Uso: editar-nota-pago-manual.cjs <idPago> "texto" [--aplicar]');
    return p.$disconnect();
  }
  const nota = texto.split('\\n').join('\n');

  const [antes] = await p.$queryRawUnsafe(
    `SELECT id, note FROM "ManualPayment" WHERE id = $1`,
    id,
  );
  if (!antes) {
    console.log('No existe un pago manual con ese id.');
    return p.$disconnect();
  }

  console.log('ANTES:');
  console.log(antes.note ?? '(sin nota)');
  console.log('\nDESPUÉS:');
  console.log(nota);

  if (!APLICAR) {
    console.log('\n[simulación] nada se escribió. Repite con --aplicar.');
    return p.$disconnect();
  }

  await p.$executeRawUnsafe(
    `UPDATE "ManualPayment" SET note = $1 WHERE id = $2`,
    nota,
    id,
  );
  const [ok] = await p.$queryRawUnsafe(
    `SELECT note FROM "ManualPayment" WHERE id = $1`,
    id,
  );
  console.log('\n✓ Guardado. Lo que quedó en la base:');
  console.log(ok.note);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
