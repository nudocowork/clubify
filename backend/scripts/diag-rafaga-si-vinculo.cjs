/**
 * SOLO LECTURA — si vinculamos la subcuenta de Clubify a la marca, ¿a cuántos
 * negocios les caería un mensaje en la próxima corrida del cron, y de qué tipo?
 *
 * Importa porque hoy esos negocios no reciben NADA: el dedup por ciclo nunca se
 * marcó, así que al abrir el canal se dispara todo lo que les toca de golpe.
 *
 * Uso:  railway run node scripts/diag-rafaga-si-vinculo.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const filas = await p.$queryRawUnsafe(`
    SELECT t.name, t.status,
           DATE_PART('day', t."currentPeriodEnd" - NOW())::int AS dias,
           t."paymentReminderSentFor" IS NOT NULL AS "yaAvisado",
           t."billingAlertsAccountId" IS NOT NULL AS "tieneCuenta",
           (t."growBusinessLocationId" IS NOT NULL) AS "credsPropias"
      FROM "Tenant" t
      JOIN "WhiteLabel" w ON w.id = t."whiteLabelId"
     WHERE w.slug = 'clubify' AND t."deletedAt" IS NULL
       AND t."currentPeriodEnd" IS NOT NULL AND t."billingAlertsEnabled"
     ORDER BY 3`);

  const cubo = { 'D-7 o antes': [], 'D-7': [], 'D-3': [], 'D-1': [], 'D-0': [], 'mora D+1..D+3': [], 'mora vieja (>3d)': [], 'lejos (no toca)': [] };
  for (const f of filas) {
    const d = f.dias;
    let k;
    if (d === 7) k = 'D-7';
    else if (d === 3) k = 'D-3';
    else if (d === 1) k = 'D-1';
    else if (d === 0) k = 'D-0';
    else if (d < 0 && d >= -3) k = 'mora D+1..D+3';
    else if (d < -3) k = 'mora vieja (>3d)';
    else k = 'lejos (no toca)';
    cubo[k].push(f);
  }
  console.log(`═══ ${filas.length} negocios de Clubify con cobro y alertas activas ═══\n`);
  for (const [k, v] of Object.entries(cubo)) {
    if (!v.length) continue;
    console.log(`  ${k.padEnd(18)} ${String(v.length).padStart(3)}`);
    if (k !== 'lejos (no toca)' && k !== 'mora vieja (>3d)') {
      for (const f of v) console.log(`      · ${f.name} (${f.status}, ${f.dias}d)`);
    }
  }
  const tocan = filas.filter((f) => f.dias <= 7 && f.dias >= -3);
  console.log(`\n  → dispararían mensaje en la próxima corrida: ${tocan.length}`);
  console.log(`  → los demás quedan a la espera de su fecha.`);
  await p.$disconnect();
})().catch(async (e) => { console.error(e.message); await p.$disconnect(); process.exit(1); });
