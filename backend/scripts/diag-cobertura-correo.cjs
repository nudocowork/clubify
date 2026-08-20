/**
 * SOLO LECTURA — ¿qué negocios pueden recibir hoy un correo del ciclo de cobro
 * y cuáles no? El correo sale por la subcuenta de Grow Business, así que la
 * pregunta real es: ¿por qué subcuenta saldría el correo de este negocio?
 *
 * Uso:  railway run node scripts/diag-cobertura-correo.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const si = (v) => (v ? 'sí' : 'NO');

(async () => {
  const marcas = await p.$queryRawUnsafe(
    `SELECT id, name, slug, domain,
            "growBusinessLocationId" IS NOT NULL
              AND "growBusinessApiKey" IS NOT NULL AS "tieneGrow",
            "emailFrom", "contactEmail"
       FROM "WhiteLabel" ORDER BY slug`,
  );
  console.log('═══ MARCAS ═══');
  for (const m of marcas) {
    const mods = await p.$queryRawUnsafe(
      `SELECT module, enabled FROM "WhiteLabelModule"
        WHERE "whiteLabelId" = $1 AND module = 'GROW_BUSINESS_SMS'`,
      m.id,
    );
    const sms = mods[0] ? si(mods[0].enabled) : 'sin fila';
    console.log(
      `  ${m.slug.padEnd(14)} grow=${si(m.tieneGrow).padEnd(3)} modSMS=${String(sms).padEnd(8)} dominio=${m.domain || '—'}`,
    );
  }

  console.log('\n═══ SUBCUENTAS GLOBALES ═══');
  const accs = await p.$queryRawUnsafe(
    `SELECT a.id, a.name, a.purpose, a."isDefault",
            (SELECT COUNT(*) FROM "Tenant" t WHERE t."billingAlertsAccountId" = a.id) AS "usanCobros"
       FROM "GrowBusinessAccount" a WHERE a."deletedAt" IS NULL
      ORDER BY a.purpose, a.name`,
  );
  for (const a of accs) {
    console.log(
      `  ${a.name.padEnd(24)} ${a.purpose.padEnd(12)} default=${si(a.isDefault).padEnd(3)} negociosCobros=${a.usanCobros}`,
    );
  }

  console.log('\n═══ NEGOCIOS CON COBRO PROGRAMADO ═══');
  const filas = await p.$queryRawUnsafe(
    `SELECT COALESCE(w.slug, '(sin marca)') AS marca,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE t.email IS NOT NULL AND t.email <> '')::int AS "conCorreo",
            COUNT(*) FILTER (WHERE t."billingAlertsEnabled")::int AS "alertasOn",
            COUNT(*) FILTER (WHERE t."billingAlertsAccountId" IS NOT NULL)::int AS "cuentaAsignada",
            COUNT(*) FILTER (WHERE t."growBusinessLocationId" IS NOT NULL
                               AND t."growBusinessApiKey" IS NOT NULL)::int AS "credsPropias",
            COUNT(*) FILTER (WHERE w."growBusinessLocationId" IS NOT NULL
                               AND w."growBusinessApiKey" IS NOT NULL)::int AS "credsDeMarca"
       FROM "Tenant" t
       LEFT JOIN "WhiteLabel" w ON w.id = t."whiteLabelId"
      WHERE t."currentPeriodEnd" IS NOT NULL AND t."deletedAt" IS NULL
      GROUP BY 1 ORDER BY 2 DESC`,
  );
  for (const f of filas) {
    console.log(
      `  ${f.marca.padEnd(14)} total=${String(f.total).padEnd(4)} correo=${String(f.conCorreo).padEnd(4)} alertasOn=${String(f.alertasOn).padEnd(4)} ctaAsignada=${String(f.cuentaAsignada).padEnd(4)} credsPropias=${String(f.credsPropias).padEnd(4)} credsMarca=${f.credsDeMarca}`,
    );
  }

  console.log('\n═══ HOY NO RECIBEN CORREO (marca sin subcuenta) ═══');
  const huerfanos = await p.$queryRawUnsafe(
    `SELECT COALESCE(w.slug, '(sin marca)') AS marca,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE t."billingAlertsAccountId" IS NOT NULL)::int AS "rescatablesPorCuenta",
            COUNT(*) FILTER (WHERE t."growBusinessLocationId" IS NOT NULL
                               AND t."growBusinessApiKey" IS NOT NULL)::int AS "rescatablesPorPropias"
       FROM "Tenant" t
       LEFT JOIN "WhiteLabel" w ON w.id = t."whiteLabelId"
      WHERE t."currentPeriodEnd" IS NOT NULL AND t."deletedAt" IS NULL
        AND t.email IS NOT NULL AND t.email <> ''
        AND (w.id IS NULL OR w."growBusinessLocationId" IS NULL OR w."growBusinessApiKey" IS NULL)
      GROUP BY 1 ORDER BY 2 DESC`,
  );
  if (!huerfanos.length) console.log('  (ninguno — todas las marcas tienen subcuenta)');
  for (const f of huerfanos) {
    console.log(
      `  ${f.marca.padEnd(14)} sinCorreoHoy=${String(f.total).padEnd(4)} → con cuenta asignada=${String(f.rescatablesPorCuenta).padEnd(4)} con creds propias=${f.rescatablesPorPropias}`,
    );
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error(e.message);
  await p.$disconnect();
  process.exit(1);
});
