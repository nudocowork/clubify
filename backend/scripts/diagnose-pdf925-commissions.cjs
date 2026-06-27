// Diagnóstico PDF 925 — vuelca el estado REAL de las comisiones de los negocios
// mencionados para confirmar causa raíz antes de corregir. SOLO LECTURA.
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/diagnose-pdf925-commissions.cjs
const { PrismaClient } = require('@prisma/client');

const NAMES = [
  'Buza',
  'Burra Burger',
  'Dolce Vita',
  'Macondo',
  'MOTILART',
  'Licores',
  'Amanecer',
];

const CANON = { MENSUAL: 68, TRIMESTRAL: 150, SEMESTRAL: 278, ANUAL: 500 };

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  for (const name of NAMES) {
    const tenants = await prisma.tenant.findMany({
      where: { brandName: { contains: name, mode: 'insensitive' } },
      select: {
        id: true,
        brandName: true,
        slug: true,
        name: true,
        email: true,
        status: true,
        planPeriodicity: true,
        subscriptionPriceUsd: true,
        whiteLabelId: true,
      },
    });
    for (const t of tenants) {
      const periodic = t.planPeriodicity ?? 'MENSUAL';
      const real = Number(t.subscriptionPriceUsd);
      const base = Number.isFinite(real) && real > 0 ? real : CANON[periodic] ?? 68;
      console.log(
        `\n=== ${t.brandName} (slug=${t.slug}) · ${t.status} · ${periodic} · subscriptionPriceUsd=${t.subscriptionPriceUsd ?? 'null'} → BASE=$${base} ===`,
      );

      const uses = await prisma.referralUse.findMany({
        where: { tenantId: t.id },
        select: {
          id: true,
          status: true,
          referralCode: {
            select: {
              id: true,
              ownerName: true,
              role: true,
              commissionPercent: true,
              maxCommissionPercent: true,
              parentCodeId: true,
              parentEmbajadorCodeId: true,
              parentCode: {
                select: { id: true, ownerName: true, role: true, commissionPercent: true },
              },
              parentEmbajadorCode: {
                select: {
                  id: true,
                  ownerName: true,
                  role: true,
                  commissionPercent: true,
                  parentCode: {
                    select: { id: true, ownerName: true, role: true, commissionPercent: true },
                  },
                },
              },
            },
          },
        },
      });
      for (const u of uses) {
        const c = u.referralCode;
        console.log(
          `  USE ${u.status}: source=${c.ownerName} [${c.role} ${Number(c.commissionPercent)}%] codeId=${c.id}`,
        );
        if (c.parentCode)
          console.log(
            `       parentCode(influencer)=${c.parentCode.ownerName} [${c.parentCode.role} ${Number(c.parentCode.commissionPercent)}%] id=${c.parentCode.id}`,
          );
        if (c.parentEmbajadorCode)
          console.log(
            `       parentEmbajador=${c.parentEmbajadorCode.ownerName} [${c.parentEmbajadorCode.role} ${Number(c.parentEmbajadorCode.commissionPercent)}%] id=${c.parentEmbajadorCode.id}` +
              (c.parentEmbajadorCode.parentCode
                ? ` → influencer=${c.parentEmbajadorCode.parentCode.ownerName} [${Number(c.parentEmbajadorCode.parentCode.commissionPercent)}%]`
                : ''),
          );
      }

      const comms = await prisma.commission.findMany({
        where: { referralUse: { tenantId: t.id } },
        select: {
          id: true,
          amount: true,
          amountPaid: true,
          status: true,
          periodKey: true,
          recipientCodeId: true,
          appliedPercent: true,
          baseAmountUsd: true,
          createdAt: true,
          recipientCode: { select: { ownerName: true, role: true, commissionPercent: true } },
          referralUse: { select: { referralCodeId: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!comms.length) console.log('  (sin comisiones)');
      for (const c of comms) {
        const amt = Number(c.amount);
        const pctOfBase = base > 0 ? ((amt / base) * 100).toFixed(1) : '?';
        const isDirect = c.recipientCodeId === c.referralUse?.referralCodeId;
        console.log(
          `  COMM ${c.status} ${c.recipientCode?.ownerName} [${c.recipientCode?.role}] $${amt} (${pctOfBase}% de base) ${isDirect ? 'DIRECTO' : 'INDIRECTO'} period=${c.periodKey} appliedPct=${c.appliedPercent ?? '·'} baseSnap=${c.baseAmountUsd ?? '·'} id=${c.id}`,
        );
      }
    }
  }

  // Settings relevantes
  const keys = ['referrals.indirectPercent', 'referrals.socioCodeId'];
  for (const k of keys) {
    const s = await prisma.setting.findUnique({ where: { key: k } });
    console.log(`\nSetting ${k} = ${s?.value ?? '(no set)'}`);
  }

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
