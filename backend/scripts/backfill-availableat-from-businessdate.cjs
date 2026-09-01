/**
 * BACKFILL (2026-08-31) — corrige el desbloqueo (availableAt) de comisiones que
 * quedaron con la fecha mal calculada.
 *
 * CAUSA (ya arreglada en el código): el helper `holdReleaseFrom` re-anclaba el
 * desbloqueo a HOY cuando el cobro era >2 días viejo, así que las renovaciones
 * creadas tarde (webhook demorado / cron de reintentos) desbloqueaban ~40-50
 * días tarde, aunque `businessDate` fuera correcta (Motilart, etc.).
 *
 * REGLA CORRECTA: availableAt = businessDate + 15 días. Este script la aplica a
 * las comisiones NO pagadas (PENDING/APPROVED) cuyo availableAt no coincide.
 * No toca las PAGADAS (su desbloqueo es histórico) ni las de grupo sin
 * businessDate. Idempotente: correrlo de nuevo no cambia nada.
 *
 * Uso:  cd backend && railway run node scripts/fix-commission-availableat.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '—');

(async () => {
  // 1) Reporte de las que se van a corregir (antes de tocar).
  const malas = await p.$queryRawUnsafe(`
    SELECT c.id, c."businessDate", c."availableAt", c."createdAt", c.status,
           c."paymentStatus", c.amount, rc."ownerName" AS afiliado, rc.code
    FROM "Commission" c
    LEFT JOIN "ReferralCode" rc ON rc.id = c."recipientCodeId"
    WHERE c."businessDate" IS NOT NULL
      AND c.status IN ('PENDING','APPROVED')
      AND c."paymentStatus" <> 'PAID'
      AND (c."availableAt" IS NULL
           OR c."availableAt" <> c."businessDate" + interval '15 days')
    ORDER BY c."businessDate"
  `);

  console.log(`Comisiones NO pagadas con desbloqueo mal calculado: ${malas.length}\n`);
  for (const c of malas.slice(0, 60)) {
    const correcto = new Date(new Date(c.businessDate).getTime() + 15 * 86400000);
    console.log(
      `  ${String(c.afiliado || '—').slice(0, 18).padEnd(18)} ${c.code || ''}` +
        ` · venta ${d(c.businessDate)} · desbloqueo ${d(c.availableAt)} → ${d(correcto)}` +
        ` · $${Number(c.amount).toFixed(2)} · ${c.status}`,
    );
  }
  if (malas.length > 60) console.log(`  … y ${malas.length - 60} más.`);

  if (!malas.length) {
    console.log('\nNada que corregir.');
    return p.$disconnect();
  }

  // 2) Corrige: availableAt = businessDate + 15 días.
  const n = await p.$executeRawUnsafe(`
    UPDATE "Commission"
    SET "availableAt" = "businessDate" + interval '15 days'
    WHERE "businessDate" IS NOT NULL
      AND status IN ('PENDING','APPROVED')
      AND "paymentStatus" <> 'PAID'
      AND ("availableAt" IS NULL
           OR "availableAt" <> "businessDate" + interval '15 days')
  `);
  console.log(`\n✓ Corregidas ${n} comisiones (availableAt = venta + 15 días).`);

  // 3) Promueve a "Disponible" (APPROVED) las que ya cumplieron el hold — es lo
  //    mismo que hace el cron horario, pero deja el estado consistente ya.
  const promo = await p.$executeRawUnsafe(`
    UPDATE "Commission"
    SET status = 'APPROVED'
    WHERE status = 'PENDING'
      AND "availableAt" IS NOT NULL
      AND "availableAt" <= NOW()
  `);
  console.log(`✓ Promovidas a Disponible (hold cumplido): ${promo}.`);
  console.log(
    '\nNota: las que ya quedaron en un corte quincenal siguen en ese corte; el' +
      ' desbloqueo mostrado ya es el correcto (venta + 15 días).',
  );
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
