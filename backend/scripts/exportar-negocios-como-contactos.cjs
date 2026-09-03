/**
 * SOLO LECTURA — exporta los NEGOCIOS de una marca como CSV listo para el
 * botón "Importar" de Email Marketing → Contactos.
 *
 * Se importa por la vía normal del módulo (no inserta en MktContact a mano),
 * para que la normalización de teléfono y la sincronización con el proveedor
 * las haga el propio motor.
 *
 * Uso:  railway run node scripts/exportar-negocios-como-contactos.cjs sellea > contactos-sellea.csv
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const SLUG = process.argv[2] || 'sellea';

// Comilla CSV segura: envuelve y duplica comillas internas.
const q = (v) => `"${String(v ?? '').replace(/"/g, '""').trim()}"`;

(async () => {
  const [wl] = await p.$queryRawUnsafe(
    `SELECT id, name FROM "WhiteLabel" WHERE slug = $1`,
    SLUG,
  );
  if (!wl) {
    console.error(`No existe la marca "${SLUG}".`);
    return p.$disconnect();
  }

  const filas = await p.$queryRawUnsafe(
    `SELECT t."brandName", t.status,
            COALESCE(u.email, t.email)              AS correo,
            COALESCE(u.phone, t."whatsappPhone", t.phone) AS telefono
       FROM "Tenant" t
       LEFT JOIN "User" u
         ON u."tenantId" = t.id AND u.role = 'TENANT_OWNER' AND u."isActive" = true
      WHERE t."whiteLabelId" = $1 AND t."deletedAt" IS NULL
      ORDER BY t."brandName"`,
    wl.id,
  );

  // Un negocio puede tener varios dueños: un contacto por correo distinto.
  const vistos = new Set();
  const salida = [];
  for (const f of filas) {
    const correo = (f.correo || '').trim().toLowerCase();
    if (!correo || vistos.has(correo)) continue;
    vistos.add(correo);
    salida.push([f.brandName, correo, f.telefono, f.brandName, f.status]);
  }

  console.log('nombre,correo,telefono,empresa,etiquetas');
  for (const r of salida) {
    console.log([q(r[0]), q(r[1]), q(r[2]), q(r[3]), q(`negocio,${r[4]}`)].join(','));
  }
  console.error(`\n(${salida.length} contactos de ${wl.name}; ${filas.length} filas leídas)`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
