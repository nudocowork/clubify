/**
 * SOLO LECTURA — diagnóstico: por qué un negocio recibe (o no) sus
 * recordatorios de cobro. No escribe absolutamente nada en la base.
 *
 * Uso:  railway run node scripts/diag-recordatorios-cobro.cjs [slugMarca]
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const SLUG = process.argv[2] || 'sellea';

(async () => {
  const [wl] = await p.$queryRawUnsafe(
    `SELECT id, name, "emailFrom", "paymentGateway",
            "growBusinessLocationId" IS NOT NULL AS "tieneGrow"
       FROM "WhiteLabel" WHERE slug = $1`,
    SLUG,
  );
  if (!wl) {
    console.log(`No existe la marca "${SLUG}".`);
    return p.$disconnect();
  }
  const mods = await p.$queryRawUnsafe(
    `SELECT module, enabled FROM "WhiteLabelModule" WHERE "whiteLabelId" = $1`,
    wl.id,
  );
  const sms = mods.find((m) => m.module === 'GROW_BUSINESS_SMS');
  console.log(`MARCA ${wl.name}`);
  console.log(`  pasarela: ${wl.paymentGateway}`);
  console.log(`  remitente de correo: ${wl.emailFrom || '(ninguno → no envía correos)'}`);
  console.log(`  subcuenta Grow propia: ${wl.tieneGrow ? 'SÍ' : 'NO'}`);
  console.log(`  módulo GROW_BUSINESS_SMS: ${sms ? (sms.enabled ? 'ACTIVO' : 'APAGADO') : 'no asignado'}`);

  const t = await p.$queryRawUnsafe(
    `SELECT t."brandName", t.email, t."currentPeriodEnd",
            t."billingAlertsEnabled", t."billingAlertsPhone",
            t."billingAlertsAccountId",
            t."growBusinessLocationId" IS NOT NULL AS "credsPropias",
            t."preReminder7dSentFor", t."preReminder3dSentFor",
            t."paymentReminderSentFor", t."preReminderTodaySentFor",
            u.phone AS "ownerPhone", t."whatsappPhone", t.phone
       FROM "Tenant" t
       LEFT JOIN "User" u
         ON u."tenantId" = t.id AND u.role = 'TENANT_OWNER' AND u."isActive" = true
      WHERE t."whiteLabelId" = $1 AND t."deletedAt" IS NULL
        AND t.status = 'ACTIVE' AND t."currentPeriodEnd" IS NOT NULL
      ORDER BY t."currentPeriodEnd"`,
    wl.id,
  );

  const hoy = new Date();
  console.log(`\n=== NEGOCIOS CON COBRO PROGRAMADO (${t.length}) ===`);
  for (const n of t) {
    const dias = Math.ceil((new Date(n.currentPeriodEnd) - hoy) / 864e5);
    const tel = n.billingAlertsPhone || n.ownerPhone || n.whatsappPhone || n.phone;
    const puedeSms =
      n.billingAlertsEnabled &&
      !!tel &&
      (n.credsPropias || !!n.billingAlertsAccountId || (wl.tieneGrow && sms?.enabled));
    console.log(`\n${n.brandName}  — cobra en ${dias}d (${f(n.currentPeriodEnd)})`);
    console.log(`  correo destino : ${n.email}`);
    console.log(`  avisos de cobro: ${n.billingAlertsEnabled ? 'ON' : 'OFF → no recibe NADA'}`);
    console.log(`  SMS            : ${puedeSms ? `sí (${tel})` : 'NO se envía'}`);
    console.log(`  correo         : ${wl.emailFrom ? 'la marca ya tiene remitente' : 'la marca NO tiene remitente'}`);
    console.log(
      `  ya enviado este ciclo → D-7:${f(n.preReminder7dSentFor)}  D-3:${f(n.preReminder3dSentFor)}` +
        `  D-1:${f(n.paymentReminderSentFor)}  D-0:${f(n.preReminderTodaySentFor)}`,
    );
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
