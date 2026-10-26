/**
 * Crea (o rota) el token del embed de Métricas para TeamClubify y deja el
 * enlace completo en un archivo local, sin imprimirlo: es una llave.
 * Rotarlo deja de servir el enlace viejo al instante.
 * Simula sin --aplicar.
 *
 *   railway run --service backend --environment production node scripts/crear-embed-metricas.cjs <archivo-salida> [--aplicar]
 */
const fs = require('fs');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const salida = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const aplicar = process.argv.includes('--aplicar');
  if (!salida) throw new Error('Uso: node scripts/crear-embed-metricas.cjs <archivo-salida> [--aplicar]');
  const ya = await prisma.setting.findUnique({ where: { key: 'metricas.embedToken' } });
  console.log(`${aplicar ? 'APLICANDO' : 'SIMULACIÓN'} · token actual: ${ya?.value ? 'existe (se reemplaza)' : 'no hay'}`);
  if (!aplicar) return;
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.setting.upsert({ where: { key: 'metricas.embedToken' }, update: { value: token }, create: { key: 'metricas.embedToken', value: token } });
  const url = `https://soyclubify.com/embed/metricas?t=${token}`;
  fs.writeFileSync(salida, url + '\n');
  console.log(`Listo. El enlace quedó en ${salida} (no lo compartas fuera del equipo).`);
})().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
