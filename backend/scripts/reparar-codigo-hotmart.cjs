/**
 * Repara un negocio cuyo código de suscriptor de Hotmart quedó mal guardado.
 *
 * EL CASO REAL (MOTILART, 2026-08-22): el negocio tenía `WKHH7U1` y Hotmart
 * manda `WKHH7U1I` — un carácter menos. `findTenant` no lo reconocía, así que
 * sus TRES pagos recurrentes (jun, jul, ago) cayeron como «comprador sin
 * cuenta»: la alerta interna decía «nueva compra» en vez de renovación, y desde
 * el 2026-08-21 el cliente además recibe el correo de «crea tu cuenta».
 *
 * Qué hace: corrige el código, deja el negocio enlazado a su última transacción
 * (para que el próximo pago se reconozca como RENOVACIÓN), avanza el ciclo y
 * marca los pagos pendientes como consumidos.
 *
 * NO reenvía nada ni genera comisiones: eso se decide aparte.
 *
 * Uso:
 *   railway run node scripts/reparar-codigo-hotmart.cjs <codigoBueno> [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const CODIGO = process.argv.slice(2).find((a) => !a.startsWith('--'));
const APLICAR = process.argv.includes('--aplicar');
const f = (d) => (d ? new Date(d).toISOString().slice(0, 16) : '—');

/** Suma meses acotando el día al último del mes destino (31-ene + 1 = 28-feb). */
const MESES = { MENSUAL: 1, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 };
function sumarPeriodo(desde, periodicidad) {
  const d = new Date(desde);
  const dia = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + (MESES[periodicidad] ?? 1));
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dia, ultimo));
  return d;
}

(async () => {
  if (!CODIGO) {
    console.log('Uso: reparar-codigo-hotmart.cjs <codigoBueno> [--aplicar]');
    return p.$disconnect();
  }

  const pagos = await p.$queryRawUnsafe(
    `SELECT id, email, "transactionId" AS tx, "createdAt", "consumedAt"
       FROM "PendingHotmartPayment" WHERE "subscriberCode" = $1 ORDER BY "createdAt"`,
    CODIGO,
  );
  if (!pagos.length) {
    console.log(`No hay pagos pendientes con el código ${CODIGO}.`);
    return p.$disconnect();
  }

  // El negocio se busca por PREFIJO: es exactamente el fallo que reparamos
  // (código guardado más corto que el que manda Hotmart).
  const candidatos = await p.$queryRawUnsafe(
    `SELECT id, "brandName", "hotmartSubscriberCode" AS sub, "hotmartTransactionId" AS tx,
            status, "currentPeriodEnd" AS cobro, "lastChargeAt" AS ultimo, "planPeriodicity" AS per
       FROM "Tenant"
      WHERE "deletedAt" IS NULL AND "hotmartSubscriberCode" IS NOT NULL
        AND $1 LIKE "hotmartSubscriberCode" || '%'`,
    CODIGO,
  );
  if (candidatos.length !== 1) {
    console.log(`Se esperaba 1 negocio cuyo código sea prefijo de ${CODIGO}; hay ${candidatos.length}.`);
    for (const c of candidatos) console.log(`   ${c.brandName} → "${c.sub}"`);
    return p.$disconnect();
  }
  const t = candidatos[0];
  const ultimoPago = pagos[pagos.length - 1];
  const nuevoCobro = sumarPeriodo(ultimoPago.createdAt, t.per);

  console.log(`negocio:            ${t.brandName}  (${t.status})`);
  console.log(`código guardado:    "${t.sub}"  (${t.sub.length} caracteres)`);
  console.log(`código de Hotmart:  "${CODIGO}"  (${CODIGO.length})`);
  console.log(`\npagos que nunca se aplicaron: ${pagos.filter((x) => !x.consumedAt).length} de ${pagos.length}`);
  for (const x of pagos) {
    console.log(`   ${f(x.createdAt)}  tx=${x.tx}  ${x.consumedAt ? 'consumido' : 'SIN APLICAR'}`);
  }
  console.log('\nquedaría así:');
  console.log(`   código               "${t.sub}"  →  "${CODIGO}"`);
  console.log(`   transacción          ${t.tx ?? 'NULL'}  →  ${ultimoPago.tx}   (para que el próximo sea RENOVACIÓN)`);
  console.log(`   último cobro         ${f(t.ultimo)}  →  ${f(ultimoPago.createdAt)}`);
  console.log(`   próximo cobro        ${f(t.cobro)}  →  ${f(nuevoCobro)}   (${t.per ?? 'MENSUAL'})`);
  console.log(`   pagos pendientes     ${pagos.length} sin consumir  →  0`);

  if (!APLICAR) {
    console.log('\n[simulación] nada se escribió. Repite con --aplicar.');
    return p.$disconnect();
  }

  await p.$executeRawUnsafe(
    `UPDATE "Tenant"
        SET "hotmartSubscriberCode" = $1,
            "hotmartTransactionId"  = $2,
            "lastChargeAt"          = $3,
            "currentPeriodEnd"      = $4,
            "failedPaymentCount"    = 0,
            -- Se limpian los avisos del ciclo viejo: si no, el negocio no
            -- recibiría ningún recordatorio del ciclo nuevo.
            "preReminder7dSentFor"     = NULL,
            "preReminder3dSentFor"     = NULL,
            "preReminderTodaySentFor"  = NULL,
            "paymentReminderSentFor"   = NULL,
            "paymentFailureNoticeSentAt" = NULL,
            "pausePendingNoticeSentAt"   = NULL
      WHERE id = $5`,
    CODIGO, ultimoPago.tx, new Date(ultimoPago.createdAt), nuevoCobro, t.id,
  );
  await p.$executeRawUnsafe(
    `UPDATE "PendingHotmartPayment" SET "consumedAt" = NOW()
      WHERE "subscriberCode" = $1 AND "consumedAt" IS NULL`,
    CODIGO,
  );

  const [ok] = await p.$queryRawUnsafe(
    `SELECT "hotmartSubscriberCode" AS sub, "hotmartTransactionId" AS tx,
            "lastChargeAt" AS ultimo, "currentPeriodEnd" AS cobro
       FROM "Tenant" WHERE id = $1`,
    t.id,
  );
  console.log('\n✓ Reparado. Como quedó en la base:');
  console.log(`   código "${ok.sub}"  ·  tx ${ok.tx}  ·  último cobro ${f(ok.ultimo)}  ·  próximo ${f(ok.cobro)}`);
  console.log('\nNo se envió ningún mensaje ni se generaron comisiones.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
