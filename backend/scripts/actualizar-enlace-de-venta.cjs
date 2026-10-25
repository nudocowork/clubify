/**
 * Cambia un enlace de venta EXTRA (los de /admin/branding) buscándolo por su
 * código de oferta (`off=`). Simula sin --aplicar.
 *
 *   node scripts/actualizar-enlace-de-venta.cjs <oferta> [--nombre "..."] [--url "..."] [--activo si|no] [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const oferta = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!oferta || oferta.startsWith('--')) throw new Error('Uso: node scripts/actualizar-enlace-de-venta.cjs <oferta> [--nombre ..] [--url ..] [--activo si|no] [--aplicar]');
  const fila = await prisma.setting.findUnique({ where: { key: 'landing.enlacesDeVenta' } });
  const lista = JSON.parse(typeof fila?.value === 'string' ? fila.value : JSON.stringify(fila?.value ?? []));
  const i = lista.findIndex((e) => { try { return new URL(e.url).searchParams.get('off') === oferta; } catch { return false; } });
  if (i < 0) throw new Error(`No hay enlace de venta con off=${oferta}`);
  const antes = { ...lista[i] };
  if (arg('--nombre')) lista[i].nombre = arg('--nombre');
  if (arg('--url')) { const u = new URL(arg('--url')); if (u.searchParams.get('off') !== oferta) throw new Error('La URL nueva no lleva la misma oferta'); lista[i].url = u.toString(); }
  if (arg('--activo')) lista[i].activo = arg('--activo') === 'si';
  console.log(`${aplicar ? 'APLICANDO' : 'SIMULACIÓN'}\n  antes:   ${JSON.stringify(antes)}\n  después: ${JSON.stringify(lista[i])}`);
  if (aplicar) await prisma.setting.update({ where: { key: 'landing.enlacesDeVenta' }, data: { value: JSON.stringify(lista) } });
}
main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
