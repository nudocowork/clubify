/**
 * Repara el código de suscriptor del grupo Aldehir (Místika).
 *
 * Los tres negocios del grupo llevan códigos SINTÉTICOS (`trial-…`), que
 * Hotmart nunca va a enviar. El código real es el de la suscripción que de
 * verdad paga, y está en `PendingHotmartPayment`. Sin esto, el cobro del 17 no
 * casa con ningún negocio, cae como «comprador sin cuenta» y las fechas no
 * avanzan solas — que es justo lo que pasó tres meses seguidos.
 *
 * El código va SOLO en el negocio que paga. Duplicarlo en los tres haría que
 * el próximo webhook casara con varios y el comportamiento sería impredecible;
 * los hermanos avanzan por `propagarCicloAlGrupo`, no por su propio código.
 *
 * SOLO LECTURA salvo que se pase `--aplicar`.
 *
 * Uso:
 *   railway run node scripts/reparar-codigo-grupo-mistika.cjs
 *   railway run node scripts/reparar-codigo-grupo-mistika.cjs --aplicar
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');

(async () => {
  const negocios = await p.$queryRawUnsafe(`
    SELECT t.id, t."brandName", t."hotmartSubscriberCode" AS cod,
           to_char(t."currentPeriodEnd",'YYYY-MM-DD') AS proximo,
           t."planPeriodicity" AS per, u.email
      FROM "Tenant" t
      LEFT JOIN "User" u ON u."tenantId" = t.id AND u.role = 'TENANT_OWNER'
     WHERE t."businessGroupId" IN (
             SELECT id FROM "BusinessGroup" WHERE name ILIKE '%mistika%')
     ORDER BY t."brandName"`);

  if (!negocios.length) {
    console.log('No encontré el grupo. Nada que hacer.');
    return p.$disconnect();
  }

  console.log('Negocios del grupo:');
  for (const n of negocios) {
    console.log(
      `  ${String(n.brandName).slice(0, 26).padEnd(26)} cod=${String(n.cod || '—').padEnd(18)} proximo=${n.proximo} per=${n.per || '—'} <${n.email || 'sin dueño'}>`,
    );
  }

  // El código real: el del pago de Hotmart que corresponde a un dueño del grupo.
  const correos = negocios.map((n) => n.email).filter(Boolean);
  if (!correos.length) {
    console.log('\nNingún negocio tiene dueño con correo. No puedo casar el pago.');
    return p.$disconnect();
  }
  const pagos = await p.$queryRawUnsafe(
    `SELECT email, "subscriberCode", "transactionId", event,
            to_char("createdAt",'YYYY-MM-DD') AS cuando
       FROM "PendingHotmartPayment"
      WHERE lower(email) = ANY($1::text[])
      ORDER BY "createdAt" DESC`,
    correos.map((c) => c.toLowerCase()),
  );

  console.log(`\nPagos de Hotmart encontrados: ${pagos.length}`);
  for (const x of pagos) {
    console.log(`  ${x.cuando} · ${x.email} · código=${x.subscriberCode} · ${x.event}`);
  }

  // Códigos reales = 8 caracteres, sin prefijo sintético.
  const reales = pagos.filter(
    (x) =>
      x.subscriberCode &&
      x.subscriberCode.length === 8 &&
      !/^(trial|wl|dup|comp)-/i.test(x.subscriberCode),
  );
  if (!reales.length) {
    console.log('\nNo hay ningún código real (8 caracteres). No toco nada.');
    return p.$disconnect();
  }

  const elegido = reales[0];
  const pagador = negocios.find(
    (n) => (n.email || '').toLowerCase() === elegido.email.toLowerCase(),
  );
  if (!pagador) {
    console.log('\nEl pago no casa con ningún dueño del grupo. No toco nada.');
    return p.$disconnect();
  }

  console.log(
    `\n→ El que paga es "${pagador.brandName}" y su código real es ${elegido.subscriberCode}`,
  );
  console.log(`   Hoy tiene: ${pagador.cod}`);

  // ¿Ese código ya lo tiene otro negocio? Si sí, parar: dos tenants con el
  // mismo código hacen que el webhook case con cualquiera de los dos.
  const choque = await p.$queryRawUnsafe(
    `SELECT id, "brandName" FROM "Tenant"
      WHERE "hotmartSubscriberCode" = $1 AND id <> $2`,
    elegido.subscriberCode,
    pagador.id,
  );
  if (choque.length) {
    console.log(
      `\n⚠️ PARO: el código ${elegido.subscriberCode} ya lo tiene "${choque[0].brandName}". Revisar a mano.`,
    );
    return p.$disconnect();
  }

  if (!APLICAR) {
    console.log('\n(en seco — volvé a correrlo con --aplicar para escribirlo)');
    return p.$disconnect();
  }

  await p.$executeRawUnsafe(
    `UPDATE "Tenant" SET "hotmartSubscriberCode" = $1 WHERE id = $2`,
    elegido.subscriberCode,
    pagador.id,
  );
  console.log(`\n✅ "${pagador.brandName}" ahora lleva el código ${elegido.subscriberCode}.`);
  console.log(
    '   El cobro del 17 va a casar con él, y sus dos hermanos avanzarán por la propagación de grupo.',
  );

  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
