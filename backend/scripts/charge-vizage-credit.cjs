// Cobro RETROACTIVO de 1 crédito a SELLEA por Vizage MedSpa, que se activó el
// 14-ago cuando la marca estaba en modo ILIMITADO (no consumió). Aprobado por
// el dueño 2026-08-16. Replica lo que el sistema habría cobrado:
//   creditsAvailable -1, creditsUsed +1, + CreditTransaction CONSUME -1 (tenantId=Vizage).
// Idempotente (aborta si ya hay CONSUME no reembolsado de Vizage) y race-safe
// (decrementa solo si hay >= cost). DRY-RUN por defecto; --apply escribe.
const { PrismaClient } = require('@prisma/client');
const COST = 1; // FULL × mensual = creditCostFor('FULL')(1) × bundleMonths(null)(1)
const NOTE = 'Cobro retroactivo · Vizage MedSpa activada 14-ago en modo ilimitado · 1 créd';

(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
  const APPLY = process.argv.includes('--apply');

  const wl = await p.whiteLabel.findFirst({
    where: { slug: 'sellea' },
    select: { id: true, name: true, creditsAvailable: true, creditsUsed: true, creditsUnlimited: true },
  });
  const t = await p.tenant.findFirst({
    where: { brandName: { contains: 'Vizage', mode: 'insensitive' } },
    select: { id: true, brandName: true, whiteLabelId: true, businessType: true, status: true },
  });
  if (!wl || !t) { console.error('Falta SELLEA o Vizage'); process.exit(1); }
  if (t.whiteLabelId !== wl.id) { console.error('Vizage no pertenece a SELLEA'); process.exit(1); }

  // Idempotencia: ¿ya hay CONSUME no reembolsado para Vizage?
  const dup = await p.creditTransaction.findFirst({
    where: { whiteLabelId: wl.id, tenantId: t.id, type: 'CONSUME', refundedAt: null },
    select: { id: true, createdAt: true },
  });

  console.log(`\nSELLEA: disponibles=${wl.creditsAvailable} usados=${wl.creditsUsed} ilimitado=${wl.creditsUnlimited}`);
  console.log(`Vizage: ${t.brandName} · ${t.status} · tipo=${t.businessType} · costo=${COST}`);
  if (dup) { console.log(`\n⚠ Ya existe CONSUME para Vizage (${dup.createdAt.toISOString().slice(0,10)}) → NO se cobra de nuevo.`); await p.$disconnect(); return; }
  if (wl.creditsUnlimited) { console.log('\n⚠ SELLEA está en ILIMITADO ahora mismo → no corresponde cobrar. Abortado.'); await p.$disconnect(); return; }
  console.log(`\nDESPUÉS (esperado): disponibles=${wl.creditsAvailable - COST} usados=${wl.creditsUsed + COST} + CONSUME -${COST}`);

  if (!APPLY) { console.log('\n[DRY-RUN] No se escribió nada. Para aplicar: --apply'); await p.$disconnect(); return; }

  // Débito race-safe.
  const debit = await p.whiteLabel.updateMany({
    where: { id: wl.id, creditsAvailable: { gte: COST } },
    data: { creditsAvailable: { decrement: COST }, creditsUsed: { increment: COST } },
  });
  if (debit.count === 0) { console.error('\n❌ SELLEA no tiene créditos suficientes. Abortado.'); await p.$disconnect(); process.exit(1); }
  await p.creditTransaction.create({
    data: { whiteLabelId: wl.id, type: 'CONSUME', amount: -COST, tenantId: t.id, note: NOTE },
  });
  const after = await p.whiteLabel.findUnique({ where: { id: wl.id }, select: { creditsAvailable: true, creditsUsed: true } });
  console.log(`\n✅ Cobrado. SELLEA ahora: disponibles=${after.creditsAvailable} usados=${after.creditsUsed} · CONSUME -${COST} registrado para Vizage.`);
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
