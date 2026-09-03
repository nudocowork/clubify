/**
 * Pone al día la fecha de cobro de un grupo empresarial y la cascadea a sus
 * negocios.
 *
 * EL CASO (Aldehir - Grupo Mistika, 2026-08-22): Hotmart cobró el 17/08 y su
 * próximo cobro es el 17/09, pero el grupo tenía 25/08 guardado. Los webhooks
 * con su código llegaron (3 cobros aprobados: 17-jun, 17-jul, 17-ago) pero
 * nunca movieron la fecha, así que los recordatorios salían a destiempo.
 *
 * La fecha del próximo cobro se toma de HOTMART, no se calcula: Hotmart es
 * quien cobra y quien manda.
 *
 * Uso:
 *   railway run node scripts/reparar-cobro-grupo.cjs <codigo> <ultimoCobro> <proximoCobro> [--aplicar]
 *   ej: ... GER6TVIT 2026-08-17 2026-09-17 --aplicar
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const libres = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [CODIGO, ULTIMO, PROXIMO] = libres;
const APLICAR = process.argv.includes('--aplicar');
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

(async () => {
  if (!CODIGO || !ULTIMO || !PROXIMO) {
    console.log('Uso: reparar-cobro-grupo.cjs <codigo> <AAAA-MM-DD ultimo> <AAAA-MM-DD proximo> [--aplicar]');
    return p.$disconnect();
  }
  const ultimo = new Date(`${ULTIMO}T12:00:00Z`);
  const proximo = new Date(`${PROXIMO}T12:00:00Z`);
  if (Number.isNaN(ultimo.getTime()) || Number.isNaN(proximo.getTime())) {
    console.log('Fechas inválidas. Formato AAAA-MM-DD.');
    return p.$disconnect();
  }

  const [g] = await p.$queryRawUnsafe(
    `SELECT id, name, status, "lastChargeAt" AS ultimo, "currentPeriodEnd" AS proximo
       FROM "BusinessGroup" WHERE "hotmartSubscriberCode" = $1 AND "deletedAt" IS NULL`,
    CODIGO,
  );
  if (!g) {
    console.log(`No hay grupo con el código ${CODIGO}.`);
    return p.$disconnect();
  }

  const tenants = await p.$queryRawUnsafe(
    `SELECT id, "brandName" AS nombre, status, "currentPeriodEnd" AS cobro
       FROM "Tenant" WHERE "businessGroupId" = $1 AND "deletedAt" IS NULL ORDER BY "brandName"`,
    g.id,
  );
  const pend = await p.$queryRawUnsafe(
    `SELECT id, "transactionId" AS tx, "createdAt" FROM "PendingHotmartPayment"
      WHERE "subscriberCode" = $1 AND "consumedAt" IS NULL ORDER BY "createdAt"`,
    CODIGO,
  );

  console.log(`grupo:  ${g.name}   (${g.status})`);
  console.log(`  último cobro   ${f(g.ultimo)}  →  ${f(ultimo)}`);
  console.log(`  próximo cobro  ${f(g.proximo)}  →  ${f(proximo)}   (según Hotmart)`);
  console.log(`\nnegocios que heredan la fecha: ${tenants.length}`);
  for (const t of tenants) {
    console.log(`  ${t.nombre.padEnd(30)} ${t.status}   ${f(t.cobro)}  →  ${f(proximo)}`);
  }
  if (pend.length) {
    console.log(`\npagos pendientes con ese código: ${pend.length} → se marcan como aplicados`);
    for (const x of pend) console.log(`  ${f(x.createdAt)}  tx=${x.tx}`);
  }

  if (!APLICAR) {
    console.log('\n[simulación] nada se escribió. Repite con --aplicar.');
    return p.$disconnect();
  }

  await p.$executeRawUnsafe(
    `UPDATE "BusinessGroup"
        SET "lastChargeAt" = $1, "currentPeriodEnd" = $2, "failedPaymentCount" = 0
      WHERE id = $3`,
    ultimo, proximo, g.id,
  );
  // Los negocios heredan la fecha del grupo, igual que al vincularlos. Y se
  // limpian los avisos del ciclo viejo: si no, ninguno recibiría los
  // recordatorios del ciclo nuevo — el fallo callado de siempre.
  await p.$executeRawUnsafe(
    `UPDATE "Tenant"
        SET "currentPeriodEnd" = $1,
            "preReminder7dSentFor" = NULL,
            "preReminder3dSentFor" = NULL,
            "preReminderTodaySentFor" = NULL,
            "paymentReminderSentFor" = NULL,
            "paymentFailureNoticeSentAt" = NULL,
            "pausePendingNoticeSentAt" = NULL
      WHERE "businessGroupId" = $2 AND "deletedAt" IS NULL`,
    proximo, g.id,
  );
  if (pend.length) {
    await p.$executeRawUnsafe(
      `UPDATE "PendingHotmartPayment" SET "consumedAt" = NOW()
        WHERE "subscriberCode" = $1 AND "consumedAt" IS NULL`,
      CODIGO,
    );
  }

  const [ok] = await p.$queryRawUnsafe(
    `SELECT "lastChargeAt" AS ultimo, "currentPeriodEnd" AS proximo FROM "BusinessGroup" WHERE id = $1`,
    g.id,
  );
  const t2 = await p.$queryRawUnsafe(
    `SELECT "brandName" AS nombre, "currentPeriodEnd" AS cobro FROM "Tenant"
      WHERE "businessGroupId" = $1 AND "deletedAt" IS NULL ORDER BY "brandName"`,
    g.id,
  );
  console.log('\n✓ Reparado.');
  console.log(`  grupo: último ${f(ok.ultimo)} · próximo ${f(ok.proximo)}`);
  for (const t of t2) console.log(`  ${t.nombre.padEnd(30)} próximo cobro ${f(t.cobro)}`);
  console.log('\nNo se envió ningún mensaje ni se generaron comisiones.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
