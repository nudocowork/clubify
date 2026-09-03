// Migración aditiva + seed para la COMISIÓN FIJA de referidos (EXCLUSIVO Sellea).
// Aditivo e idempotente (ADD COLUMN IF NOT EXISTS + upsert de Settings). NUNCA
// `prisma db push`/`migrate diff` a prod. Diseño: sesión 2026-08-27.
//
//   cd backend
//   export DATABASE_PUBLIC_URL="$(railway variables --service Postgres-Nq8w --json \
//     | python3 -c 'import json,sys;print(json.load(sys.stdin)["DATABASE_PUBLIC_URL"])')"
//   node scripts/apply-referral-fixed-commission.cjs
//
// Qué hace:
//  1) ReferralCode.fixedCommissionUsd DECIMAL(10,2) NULL  (solo la usan códigos
//     de marcas en modo FIXED_ONCE; el resto queda NULL = comportamiento normal).
//  2) Settings por-marca para Sellea (slug 'sellea'):
//       referrals.commissionMode.sellea = FIXED_ONCE
//       referrals.fixed.negocio.sellea  = 30   (negocio-cliente auto-registrado)
//       referrals.fixed.influencer.sellea = 80 (influencer creado por admin)
//       referrals.fixed.embajador.sellea  = 40 (embajador creado por admin)
//  NO toca ninguna otra marca. Cambiar un monto = editar el value del Setting.
const { PrismaClient } = require('@prisma/client');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

// Slug de la marca. DEBE coincidir con WhiteLabel.slug (lo que devuelve
// resolveSignupBrandByHost) para que las claves Setting casen.
const SLUG = 'sellea';
const SETTINGS = [
  [`referrals.commissionMode.${SLUG}`, 'FIXED_ONCE'],
  [`referrals.fixed.negocio.${SLUG}`, '30'],
  [`referrals.fixed.influencer.${SLUG}`, '80'],
  [`referrals.fixed.embajador.${SLUG}`, '40'],
];

(async () => {
  // Guard: verificar que la marca 'sellea' existe con ese slug exacto.
  const wl = await p.whiteLabel.findFirst({
    where: { slug: SLUG },
    select: { id: true, name: true, appDomain: true },
  });
  if (!wl) {
    throw new Error(`ABORT: no existe WhiteLabel con slug='${SLUG}'. Revisá el slug real.`);
  }
  console.log(`Marca: ${wl.name} (slug=${SLUG}, app=${wl.appDomain})`);

  // 1) Columna aditiva.
  await p.$executeRawUnsafe(
    `ALTER TABLE "ReferralCode" ADD COLUMN IF NOT EXISTS "fixedCommissionUsd" DECIMAL(10,2)`,
  );
  console.log('✔ Columna ReferralCode.fixedCommissionUsd lista');

  // 2) Seed de Settings (upsert idempotente). NO pisamos un value existente si
  //    ya fue ajustado a mano — solo creamos el que falte.
  for (const [key, value] of SETTINGS) {
    const existing = await p.setting.findUnique({ where: { key } });
    if (existing) {
      console.log(`  = ${key} ya existe = "${existing.value}" (no lo toco)`);
    } else {
      await p.setting.create({ data: { key, value } });
      console.log(`  + ${key} = "${value}"`);
    }
  }

  // 3) Verificación.
  const check = await p.setting.findMany({
    where: { key: { in: SETTINGS.map((s) => s[0]) } },
    orderBy: { key: 'asc' },
  });
  console.log(`\nSettings de Sellea (${check.length}/4):`);
  check.forEach((s) => console.log(`  ${s.key} = ${s.value}`));

  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
