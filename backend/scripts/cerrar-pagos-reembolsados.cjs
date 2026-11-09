/**
 * Cierra los «pagos sin activar» de Hotmart que ya fueron REEMBOLSADOS o
 * contracargados (Angelica Barrantes, 2026-11-09).
 *
 * Desde este despliegue el webhook los cierra solo y la lista los esconde,
 * pero los anteriores siguen abiertos: si el comprador creara la cuenta,
 * /activar los consumiría y activaría un negocio con un dinero devuelto.
 *
 * Detecta la devolución por el aviso de Hotmart guardado o por el libro
 * (IncomeRecord en REEMBOLSADO). Si Hotmart nunca avisó, no lo verá: para esos
 * está el botón «Quitar» de la pantalla.
 *
 * Por defecto SOLO muestra lo que haría. Escribe con --aplicar.
 *
 *   railway run --service backend --environment production --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
 *     node scripts/cerrar-pagos-reembolsados.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const APLICAR = process.argv.includes('--aplicar');

(async () => {
  const filas = await p.$queryRawUnsafe(`
    SELECT ph.id, ph.email, ph."transactionId" AS tx, ph."createdAt"::date AS dia,
           (SELECT e."eventType" FROM "HotmartWebhookEvent" e
             WHERE e."eventType" IN ('PURCHASE_REFUNDED','PURCHASE_CHARGEBACK')
               AND e.payload->'data'->'purchase'->>'transaction' = ph."transactionId"
             LIMIT 1) AS aviso,
           (SELECT i.status FROM "IncomeRecord" i
             WHERE i.gateway = 'HOTMART' AND i."externalTxId" = ph."transactionId"
               AND i.status = 'REEMBOLSADO' LIMIT 1) AS libro
      FROM "PendingHotmartPayment" ph
     WHERE ph."consumedAt" IS NULL AND ph."transactionId" IS NOT NULL`);
  const devueltos = filas.filter((r) => r.aviso || r.libro);
  console.log(`${filas.length} pagos sin activar con transacción; ${devueltos.length} ya devueltos:`);
  for (const r of devueltos) {
    console.log(`  ${r.email} · ${r.dia.toISOString().slice(0, 10)} · ${r.tx} · ${r.aviso ?? 'libro: ' + r.libro}`);
  }
  if (!APLICAR) {
    console.log('\nSimulación: no se escribió nada. Repite con --aplicar.');
    return;
  }
  if (devueltos.length === 0) return;
  const r = await p.pendingHotmartPayment.updateMany({
    where: { id: { in: devueltos.map((d) => d.id) }, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await p.auditLog.createMany({
    data: devueltos.map((d) => ({
      actorId: null,
      tenantId: null,
      action: 'pending_payment.discarded',
      resource: `pending_hotmart_payment:${d.id}`,
      metadata: { motivo: 'REEMBOLSO', origen: 'cerrar-pagos-reembolsados.cjs', transactionId: d.tx },
    })),
  });
  console.log(`\nListo: ${r.count} cerrado(s).`);
})()
  .catch((e) => { console.error('ERROR:', e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
