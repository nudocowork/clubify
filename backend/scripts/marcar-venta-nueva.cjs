// Pasa a VENTA NUEVA el ingreso del pago manual de un negocio que quedó como
// RENOVACIÓN por error (Pagos por aprobar antes del arreglo del 2026-10-27:
// el negocio recién creado ya traía fecha de corte y se leía como renovación).
//
// Uso: node scripts/marcar-venta-nueva.cjs <tenantId> [--aplicar]
// Sin --aplicar solo muestra lo que cambiaría.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const tenantId = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!tenantId) throw new Error('Falta el id del negocio.');
  const filas = await prisma.incomeRecord.findMany({
    where: { tenantId, gateway: 'MANUAL', category: 'RENOVACION' },
    select: { id: true, grossUsd: true, saleDate: true, brandName: true },
  });
  const previos = await prisma.incomeRecord.count({ where: { tenantId, category: 'NUEVA' } });
  console.log(filas, '| ventas nuevas que ya tiene:', previos);
  if (filas.length !== 1 || previos > 0) throw new Error('Esperaba exactamente 1 renovación manual y ninguna venta nueva: no toco nada.');
  if (!aplicar) return console.log('Simulación. Para aplicar: --aplicar');
  const r = await prisma.incomeRecord.updateMany({
    where: { id: filas[0].id, category: 'RENOVACION' },
    data: { category: 'NUEVA', isFirstPayment: true },
  });
  console.log('Actualizado:', r.count);
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
