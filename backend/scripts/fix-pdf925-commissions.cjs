// PDF 925 — Corrige las comisiones mal calculadas de los negocios mencionados.
// Recalcula cada comisión PENDING/APPROVED a base × %correcto usando la MISMA
// regla que el backend desplegado:
//   - AMBASSADOR / VENDOR (recipiente): su commissionPercent.
//   - INFLUENCER: DIRECTO (es el source y NO hay embajador/vendedor en la
//     cadena) → su commissionPercent; INDIRECTO (la venta entró por un
//     embajador) → referrals.indirectPercent (5%).
// base = subscriptionPriceUsd real ?? canónico del bundle.
// MOTILART: además fija subscriptionPriceUsd = 50 (venta aparte a $50).
// NO toca PAID (Dolce Vita / históricas correctas quedan intactas).
// Idempotente: solo escribe si el monto cambia. Dry-run por defecto; APPLY=1.
//
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/fix-pdf925-commissions.cjs
//   railway run --service Postgres-Nq8w bash -c 'APPLY=1 node /ABS/PATH/backend/scripts/fix-pdf925-commissions.cjs'
const { PrismaClient } = require('@prisma/client');

const NAMES = [
  'Buza',
  'Burra Burger',
  "Trucco",
  'Veterinaria',
  'Danlu',
  'Macondo',
  'Dolce',
  'MOTILART',
  'Licores',
  'Amanecer',
];
const CANON = { MENSUAL: 68, TRIMESTRAL: 150, SEMESTRAL: 278, ANUAL: 500 };
const r2 = (n) => Math.round(n * 100) / 100;

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const apply = process.env.APPLY === '1';
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const indirectRow = await prisma.setting.findUnique({
    where: { key: 'referrals.indirectPercent' },
  });
  const INDIRECT = indirectRow?.value != null ? Number(indirectRow.value) : 5;

  // Negocios objetivo (dedup por id).
  const seen = new Set();
  const tenants = [];
  for (const name of NAMES) {
    const found = await prisma.tenant.findMany({
      where: { brandName: { contains: name, mode: 'insensitive' } },
      select: {
        id: true,
        brandName: true,
        planPeriodicity: true,
        subscriptionPriceUsd: true,
      },
    });
    for (const t of found) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        tenants.push(t);
      }
    }
  }

  let changes = 0;
  for (const t of tenants) {
    // MOTILART: la venta fue aparte a $50 → fijar el precio real ANTES de la base.
    let subPrice = t.subscriptionPriceUsd != null ? Number(t.subscriptionPriceUsd) : null;
    if (/motilart/i.test(t.brandName) && subPrice !== 50) {
      console.log(`\n[${t.brandName}] subscriptionPriceUsd ${subPrice ?? 'null'} → 50`);
      if (apply) {
        await prisma.tenant.update({
          where: { id: t.id },
          data: { subscriptionPriceUsd: 50 },
        });
      }
      subPrice = 50;
      changes++;
    }

    const periodic = t.planPeriodicity ?? 'MENSUAL';
    const base = subPrice && subPrice > 0 ? subPrice : CANON[periodic] ?? 68;

    const uses = await prisma.referralUse.findMany({
      where: {
        tenantId: t.id,
        status: { in: ['SIGNED_UP', 'ACTIVE', 'PAYING'] },
      },
      select: { referralCodeId: true, referralCode: { select: { role: true } } },
    });
    const hasUpline = uses.some(
      (u) => u.referralCode.role === 'AMBASSADOR' || u.referralCode.role === 'VENDOR',
    );
    const hasVendor = uses.some((u) => u.referralCode.role === 'VENDOR');
    if (hasVendor) {
      console.log(
        `\n[${t.brandName}] tiene VENDOR en la cadena — split embajador−vendedor, NO lo toco por script (usar arqueo+Actualizar).`,
      );
      continue;
    }

    const comms = await prisma.commission.findMany({
      where: {
        referralUse: { tenantId: t.id },
        status: { in: ['PENDING', 'APPROVED'] },
      },
      select: {
        id: true,
        amount: true,
        status: true,
        recipientCodeId: true,
        recipientCode: { select: { ownerName: true, role: true, commissionPercent: true } },
      },
    });
    if (!comms.length) continue;
    console.log(`\n=== ${t.brandName} · base $${base} · ${periodic} ===`);
    for (const c of comms) {
      const role = c.recipientCode?.role;
      let pct;
      if (role === 'INFLUENCER') {
        const isSourceInfluencer = uses.some(
          (u) => u.referralCodeId === c.recipientCodeId,
        );
        pct = isSourceInfluencer && !hasUpline
          ? Number(c.recipientCode?.commissionPercent ?? 0)
          : INDIRECT;
      } else {
        pct = Number(c.recipientCode?.commissionPercent ?? 0);
      }
      const target = r2((base * pct) / 100);
      const current = Number(c.amount);
      const flag = Math.abs(current - target) > 0.01 ? '→ FIX' : 'ok';
      console.log(
        `  ${c.recipientCode?.ownerName} [${role}] ${pct}% : $${current} → $${target} ${flag}`,
      );
      if (flag === '→ FIX' && apply) {
        await prisma.commission.update({
          where: { id: c.id },
          data: { amount: target },
        });
      }
      if (flag === '→ FIX') changes++;
    }
  }

  console.log(
    `\n${apply ? 'Aplicados' : 'Se aplicarían'}: ${changes} cambios. INDIRECT=${INDIRECT}%`,
  );
  if (!apply) console.log("Re-corre con bash -c 'APPLY=1 node ...' para escribir.");
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
