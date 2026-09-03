/**
 * SOLO LECTURA — ¿se mandaron los recordatorios de cobro de una marca?
 *
 * Mientras no exista el historial de envíos, ésta es la única forma de saberlo:
 * los campos de dedup por ciclo. El cron los iguala a `currentPeriodEnd` cuando
 * logra avisar, así que "marcado" == "salió por algún canal en este ciclo".
 *
 * Limitación honesta: dice QUÉ se marcó, no por qué canal ni si el proveedor lo
 * entregó. Para eso hace falta el MessageLog.
 *
 * Uso:  railway run node scripts/diag-recordatorios-enviados.cjs [slugMarca]
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const SLUG = process.argv[2] || 'sellea';
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : null);

(async () => {
  const filas = await p.$queryRawUnsafe(`
    SELECT t.name, t."currentPeriodEnd" AS cobro,
           DATE_PART('day', t."currentPeriodEnd" - NOW())::int AS faltan,
           t."preReminder7dSentFor"    AS m7,
           t."preReminder3dSentFor"    AS m3,
           t."preReminderTodaySentFor" AS m1,
           t."paymentReminderSentFor"  AS m0,
           t."billingAlertsEnabled"    AS alertas,
           t.email, t."whatsappPhone", t.phone
      FROM "Tenant" t JOIN "WhiteLabel" w ON w.id = t."whiteLabelId"
     WHERE w.slug = $1 AND t."deletedAt" IS NULL AND t."currentPeriodEnd" IS NOT NULL
     ORDER BY t."currentPeriodEnd"`, SLUG);

  if (!filas.length) return console.log(`La marca "${SLUG}" no tiene negocios con cobro.`) || p.$disconnect();
  console.log(`\n=== ${SLUG.toUpperCase()} — ${filas.length} negocios con cobro programado ===\n`);

  for (const f of filas) {
    const ciclo = d(f.cobro);
    // "marcado" = el campo apunta al ciclo vigente
    const marca = (v) => (d(v) === ciclo ? 'SI' : d(v) ? 'ciclo viejo' : '--');
    console.log(`${f.name}`);
    console.log(`   cobro ${ciclo} (faltan ${f.faltan} d)   alertas=${f.alertas ? 'on' : 'OFF'}   correo=${f.email ? 'si' : 'NO'}   tel=${f.whatsappPhone || f.phone ? 'si' : 'NO'}`);
    console.log(`   D-7=${marca(f.m7).padEnd(11)} D-3=${marca(f.m3).padEnd(11)} D-1=${marca(f.m1).padEnd(11)} D-0=${marca(f.m0)}`);
    const toca = (dias, v) => f.faltan < dias && d(v) !== ciclo && f.alertas;
    const perdidos = [];
    if (toca(7, f.m7)) perdidos.push('D-7');
    if (toca(3, f.m3)) perdidos.push('D-3');
    if (toca(1, f.m1)) perdidos.push('D-1');
    if (perdidos.length) console.log(`   *** ya pasó la fecha y NO se marcó: ${perdidos.join(', ')}`);
    console.log('');
  }
  console.log('SI = se avisó en este ciclo · -- = todavía no toca o no se avisó');
  await p.$disconnect();
})().catch(async (e) => { console.error(e.message); await p.$disconnect(); process.exit(1); });
