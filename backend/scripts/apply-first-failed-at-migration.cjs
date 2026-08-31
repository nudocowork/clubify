/**
 * Migración ADITIVA — Fase 1 del control de renovaciones/suspensión (2026-08-31).
 *
 * Agrega `Tenant.firstFailedAt` (TIMESTAMP nullable): el ANCLA INMUTABLE de la
 * mora. Se fija una sola vez en el 1er cobro fallido (o vencimiento sin pago) y
 * NO se reescribe en los reintentos de Hotmart — a diferencia de
 * `lastPaymentAttemptAt`, que Hotmart pisa a `now` en cada `PURCHASE_DELAYED` y
 * reiniciaba el reloj de gracia (por eso nunca llegaba al día 6 y no suspendía).
 *
 * Hace 3 cosas, todas idempotentes:
 *   1) ADD COLUMN IF NOT EXISTS "firstFailedAt".
 *   2) Backfill del ancla para los morosos EN VUELO (failedPaymentCount>0 y
 *      firstFailedAt NULL): les copia lastPaymentAttemptAt como mejor ancla
 *      disponible, para que no pierdan su reloj de gracia al desplegar.
 *   3) Fija el Setting `billing.graceDays` = 5 (la gracia acordada). El código
 *      ya usa 5 por defecto, pero si en prod había un valor viejo (p.ej. 3),
 *      esto lo alinea. Se puede cambiar luego desde el panel.
 *
 * NO borra ni modifica nada más. Se puede correr varias veces sin efecto.
 *
 * Uso:  cd backend && railway run node scripts/apply-first-failed-at-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  // ── 1) Columna ────────────────────────────────────────────────────────────
  const existe = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Tenant' AND column_name = 'firstFailedAt'
  `);
  if (existe.length) {
    console.log('La columna "firstFailedAt" ya existe.');
  } else {
    console.log('Agregando Tenant."firstFailedAt" (TIMESTAMP, nullable)…');
    await p.$executeRawUnsafe(
      `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "firstFailedAt" TIMESTAMP(3)`,
    );
    const chk = await p.$queryRawUnsafe(`
      SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'Tenant' AND column_name = 'firstFailedAt'
    `);
    console.log('  →', chk[0] || '(no se creó)');
  }

  // ── 2) Backfill del ancla para morosos en vuelo ────────────────────────────
  // Solo los que HOY están en mora (failedPaymentCount>0) y no tienen ancla.
  // Usamos lastPaymentAttemptAt (la mejor referencia disponible); si tampoco lo
  // tienen, se deja NULL y el código cae al fallback legacy.
  const backfill = await p.$executeRawUnsafe(`
    UPDATE "Tenant"
    SET "firstFailedAt" = "lastPaymentAttemptAt"
    WHERE "failedPaymentCount" > 0
      AND "firstFailedAt" IS NULL
      AND "lastPaymentAttemptAt" IS NOT NULL
  `);
  console.log(`Backfill de ancla en morosos en vuelo: ${backfill} tenant(s).`);

  // ── 3) Gracia = 5 días ─────────────────────────────────────────────────────
  const prev = await p.setting
    .findUnique({ where: { key: 'billing.graceDays' } })
    .catch(() => null);
  await p.setting.upsert({
    where: { key: 'billing.graceDays' },
    update: { value: '5' },
    create: { key: 'billing.graceDays', value: '5' },
  });
  console.log(
    `Setting billing.graceDays: ${prev?.value ?? '(no existía)'} → 5` +
      ' (gracia cubre días 1..5; al día 6 se suspende).',
  );

  // ── Resumen de lo que quedará sujeto a auto-suspensión ──────────────────────
  const morosos = await p.$queryRawUnsafe(`
    SELECT "brandName", "failedPaymentCount", "firstFailedAt", "currentPeriodEnd",
           "manualPayment"
    FROM "Tenant"
    WHERE status = 'ACTIVE'
      AND ("failedPaymentCount" > 0 OR "currentPeriodEnd" < NOW())
    ORDER BY "firstFailedAt" NULLS LAST
    LIMIT 40
  `);
  console.log(`\nTenants ACTIVE en mora o vencidos (muestra de ${morosos.length}):`);
  for (const t of morosos) {
    const ancla = t.firstFailedAt || t.currentPeriodEnd;
    console.log(
      `  ${t.brandName}` +
        ` · fallos=${t.failedPaymentCount}` +
        ` · ancla=${ancla ? new Date(ancla).toISOString().slice(0, 10) : '—'}` +
        ` · ${t.manualPayment ? 'PAGO POR FUERA' : 'pasarela'}`,
    );
  }
  console.log(
    '\nListo. El cron diario de mora (3 AM) suspenderá los que superen el día 6.',
  );
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
