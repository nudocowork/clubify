/**
 * SOLO LECTURA — pagos «sin cuenta» que en realidad son de un negocio que YA
 * existe.
 *
 * Pasó con MOTILART: código de suscriptor truncado (WKHH7U1 vs WKHH7U1I) y
 * correo del pagador distinto al de la cuenta. Sus 3 pagos recurrentes cayeron
 * como comprador nuevo. Este diagnóstico busca los demás casos por tres vías
 * antes de que alguien los descubra por una queja.
 *
 * Uso:  railway run node scripts/diag-pagos-huerfanos.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

(async () => {
  const pend = await p.$queryRawUnsafe(`
    SELECT id, email, "subscriberCode" AS sub, "transactionId" AS tx, "createdAt"
      FROM "PendingHotmartPayment" WHERE "consumedAt" IS NULL ORDER BY "createdAt"`);
  console.log(`pagos sin aplicar: ${pend.length}\n`);

  const tenants = await p.$queryRawUnsafe(`
    SELECT id, "brandName", email, "hotmartSubscriberCode" AS sub, status
      FROM "Tenant" WHERE "deletedAt" IS NULL`);

  let sospechosos = 0;
  for (const x of pend) {
    const porCorreo = tenants.find((t) => (t.email ?? '').toLowerCase() === (x.email ?? '').toLowerCase());
    const porPrefijo = x.sub
      ? tenants.find((t) => t.sub && t.sub !== x.sub && x.sub.startsWith(t.sub))
      : null;
    const otrosPagos = pend.filter((y) => y.sub && y.sub === x.sub).length;

    const pista = porCorreo ?? porPrefijo;
    if (!pista && otrosPagos < 2) continue;
    sospechosos++;
    console.log(`▸ ${x.email}  (${f(x.createdAt)})  código=${x.sub ?? '—'}`);
    if (porCorreo) console.log(`    el correo COINCIDE con el negocio: ${porCorreo.brandName} (${porCorreo.status})`);
    if (porPrefijo) console.log(`    el código del negocio "${porPrefijo.sub}" es PREFIJO del suyo → ${porPrefijo.brandName} (${porPrefijo.status})`);
    if (!pista && otrosPagos >= 2) console.log(`    ${otrosPagos} pagos con el MISMO código sin aplicar → parece recurrente, no una compra nueva`);
    console.log('');
  }
  console.log(sospechosos ? `${sospechosos} pagos merecen revisión.` : 'Ninguno parece de un negocio existente.');
  await p.$disconnect();
})().catch(async (e) => { console.error(e.message); await p.$disconnect(); process.exit(1); });
