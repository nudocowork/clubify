// Renombra el producto "Living Card" → "Cuponera Card" en los datos de
// producción (2026-09-01).
//
// POR QUÉ HACE FALTA UN SCRIPT. `ensureLivingCampaign()` es idempotente: si la
// campaña ya existe, la devuelve tal cual y NO toca sus campos. Cambiar el
// literal en el código solo afecta a una campaña que se cree de cero. La que
// corre hoy en producción sigue llamándose "Living Card" hasta que alguien
// actualice la fila. Eso hace esto.
//
// QUÉ NO TOCA. El slug `living-card` ni el slug `sys-living-card`. Son las
// llaves con las que el backend encuentra la campaña; cambiarlas no la renombra,
// hace que no la encuentre y cree una segunda vacía, dejando huérfanos aliados,
// miembros y canjes. Tampoco salen en ninguna URL pública.
//
// Idempotente: reemplaza el literal donde aparece. Correrlo dos veces no
// encuentra nada la segunda vez.
//
// Uso:
//   cd backend
//   export DATABASE_PUBLIC_URL="$(railway variables --service Postgres-Nq8w --json \
//     | python3 -c 'import json,sys;print(json.load(sys.stdin)["DATABASE_PUBLIC_URL"])')"
//   node scripts/apply-rename-cuponera-card.cjs          # simulacro
//   APPLY=1 node scripts/apply-rename-cuponera-card.cjs  # escribe
const { PrismaClient } = require('@prisma/client');

const VIEJO = 'Living Card';
const NUEVO = 'Cuponera Card';
const CAMPAIGN_SLUG = 'living-card';
const SYSTEM_TENANT_SLUG = 'sys-living-card';

/** Columnas de texto que ve un usuario. El slug NO está acá a propósito. */
const CAMPOS = [
  ['BenefitCampaign', ['name', 'welcomeText'], `"slug" = '${CAMPAIGN_SLUG}'`],
  ['Tenant', ['name', 'brandName'], `"slug" = '${SYSTEM_TENANT_SLUG}'`],
  ['MembershipPlan', ['name', 'description'], `"campaignId" IN (SELECT id FROM "BenefitCampaign" WHERE "slug" = '${CAMPAIGN_SLUG}')`],
  ['Card', ['name', 'walletBrandName', 'description', 'terms', 'rewardText', 'howToEarnText', 'rewardDescText'], `"tenantId" IN (SELECT id FROM "Tenant" WHERE "slug" = '${SYSTEM_TENANT_SLUG}')`],
  ['BenefitCategory', ['name'], `"campaignId" IN (SELECT id FROM "BenefitCampaign" WHERE "slug" = '${CAMPAIGN_SLUG}')`],
  ['Benefit', ['title', 'description'], `"campaignId" IN (SELECT id FROM "BenefitCampaign" WHERE "slug" = '${CAMPAIGN_SLUG}')`],
  ['StampProgram', ['name', 'rewardText'], `"campaignId" IN (SELECT id FROM "BenefitCampaign" WHERE "slug" = '${CAMPAIGN_SLUG}')`],
];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('❌ Falta DATABASE_PUBLIC_URL (o DATABASE_URL).'); process.exit(1); }
  const apply = process.env.APPLY === '1';
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  console.log(apply ? '⚙️  APLICANDO cambios\n' : '👀 SIMULACRO — nada se escribe (APPLY=1 para escribir)\n');

  let total = 0;
  for (const [tabla, columnas, filtro] of CAMPOS) {
    for (const col of columnas) {
      let filas;
      try {
        filas = await prisma.$queryRawUnsafe(
          `SELECT id, "${col}" AS v FROM "${tabla}" WHERE ${filtro} AND "${col}" LIKE '%${VIEJO}%'`,
        );
      } catch (e) {
        // Una columna que no existe en este esquema no es un error: se salta.
        console.log(`   ⚠️  ${tabla}.${col}: ${String(e.message).split('\n').pop().trim()}`);
        continue;
      }
      if (!filas.length) continue;

      for (const f of filas) {
        console.log(`   ${tabla}.${col}`);
        console.log(`     − ${f.v}`);
        console.log(`     + ${String(f.v).split(VIEJO).join(NUEVO)}`);
      }
      total += filas.length;

      if (apply) {
        await prisma.$executeRawUnsafe(
          `UPDATE "${tabla}" SET "${col}" = REPLACE("${col}", '${VIEJO}', '${NUEVO}') WHERE ${filtro} AND "${col}" LIKE '%${VIEJO}%'`,
        );
      }
    }
  }

  // El branding del marketplace vive dentro de config (JSON). Se avisa pero no
  // se reescribe a ciegas: ahí también hay secretos cifrados de MercadoPago.
  const conf = await prisma.$queryRawUnsafe(
    `SELECT id, config::text AS c FROM "BenefitCampaign" WHERE "slug" = '${CAMPAIGN_SLUG}' AND config::text LIKE '%${VIEJO}%'`,
  );
  if (conf.length) {
    console.log(`\n   ⚠️  BenefitCampaign.config menciona "${VIEJO}" — revisar a mano desde el panel.`);
    console.log(`       (No se toca automáticamente: ese JSON guarda los secretos de MercadoPago.)`);
  }

  console.log(total === 0
    ? '\n✅ Nada que renombrar: ya está todo como "Cuponera Card".'
    : `\n${apply ? '✅ Renombrados' : '📋 Se renombrarían'} ${total} campo(s).`);

  if (!apply && total > 0) console.log('   Para escribir: APPLY=1 node scripts/apply-rename-cuponera-card.cjs');

  await prisma.$disconnect();
})().catch((e) => { console.error('❌', e); process.exit(1); });
