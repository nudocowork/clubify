/**
 * Pone el QR de un cartel ENCIMA de todas las imágenes (y opcionalmente lo
 * mueve). Para carteles cuya imagen de fondo trae un QR «horneado» que tapa
 * el QR real del editor: Pipe Gomitas (2026-10-26) subió un arte con un QR al
 * menú encima del QR de la tarjeta, y el cartel impreso llevaba al menú.
 * Simula sin --aplicar.
 *
 *   node scripts/qr-al-frente.cjs <posterId> [--x 342] [--y 585] [--size 384] [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
(async () => {
  const id = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  const p = await prisma.qrPoster.findUnique({ where: { id }, select: { config: true } });
  if (!p) throw new Error('No existe el cartel');
  const c = p.config;
  const orden = (c.layerOrder || []).filter((k) => k !== 'qr');
  const iFooter = orden.indexOf('footer');
  orden.splice(iFooter >= 0 ? iFooter : orden.length, 0, 'qr');
  const qr = {
    ...c.qr,
    ...(arg('--x') ? { x: Number(arg('--x')) } : {}),
    ...(arg('--y') ? { y: Number(arg('--y')) } : {}),
    ...(arg('--size') ? { size: Number(arg('--size')) } : {}),
  };
  console.log(`${aplicar ? 'APLICANDO' : 'SIMULACIÓN'}\n  orden antes:   ${JSON.stringify(c.layerOrder)}\n  orden después: ${JSON.stringify(orden)}\n  qr: ${JSON.stringify(c.qr)} → ${JSON.stringify(qr)}`);
  if (aplicar) await prisma.qrPoster.update({ where: { id }, data: { config: { ...c, layerOrder: orden, qr } } });
})().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
