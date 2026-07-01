// Diagnóstico (solo lectura) para el PDF de comisiones/conteos:
//  A) Para Wok/Mykoz/Valmont/Pócimas: dump del precio, cadena y comisiones
//     (amount, baseAmountUsd, appliedPercent, %, recipiente + su commissionPercent)
//     → revela de dónde sale el 15% / 2% / neto.
//  B) Usuarios Samuel vs Javier: rol + whiteLabelId, y distribución de negocios
//     por marca → revela por qué el conteo difiere (54 vs 46).
//
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/diagnose-commissions-and-counts.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const clubify = await prisma.whiteLabel.findFirst({
    where: { slug: 'clubify' }, select: { id: true },
  });
  const clubifyId = clubify?.id ?? null;

  // ---------- A) COMISIONES ----------
  console.log('======== A) COMISIONES (Wok / Mykoz / Valmont / Pócimas) ========\n');
  const terms = ['wok', 'mykoz', 'valmont', 'pócima', 'pocima', 'lauren'];
  const or = terms.map((t) => ({ brandName: { contains: t, mode: 'insensitive' } }));
  const tenants = await prisma.tenant.findMany({
    where: { OR: or },
    select: {
      id: true, brandName: true, subscriptionPriceUsd: true, planPeriodicity: true,
      whiteLabelId: true,
    },
  });

  for (const t of tenants) {
    console.log(`• ${t.brandName}`);
    console.log(`    subscriptionPriceUsd: ${t.subscriptionPriceUsd ?? 'null'}  · periodicidad: ${t.planPeriodicity ?? 'null'}`);
    const comms = await prisma.commission.findMany({
      where: { referralUse: { tenantId: t.id } },
      select: {
        id: true, amount: true, baseAmountUsd: true, appliedPercent: true,
        status: true, createdAt: true,
        recipientCode: { select: { ownerName: true, role: true, commissionPercent: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (comms.length === 0) { console.log('    (sin comisiones)\n'); continue; }
    for (const c of comms) {
      const amt = Number(c.amount);
      const base = c.baseAmountUsd == null ? null : Number(c.baseAmountUsd);
      const pctSnap = c.appliedPercent == null ? null : Number(c.appliedPercent);
      const pctDerived = base && base > 0 ? Math.round((amt / base) * 100 * 100) / 100 : null;
      console.log(
        `    - ${c.recipientCode?.ownerName ?? '(?)'} [${c.recipientCode?.role ?? '?'}] ` +
        `code%=${c.recipientCode?.commissionPercent ?? '?'}  |  monto=$${amt}  baseAmountUsd=${base ?? 'null'}  ` +
        `appliedPercent=${pctSnap ?? 'null'}  (derivado amount/base=${pctDerived ?? 'n/a'}%)  ${c.status}`,
      );
    }
    // Excepciones por tenant
    const exc = await prisma.commissionException.findMany({
      where: { tenantId: t.id },
      select: { customPercent: true, isActive: true, recipientCode: { select: { ownerName: true } } },
    });
    if (exc.length) {
      console.log('    Excepciones:');
      for (const e of exc) console.log(`      · ${e.recipientCode?.ownerName ?? '?'}: ${e.customPercent}% (activa=${e.isActive})`);
    }
    console.log('');
  }

  // Códigos de Nico y Sara (recipiente INFLUENCER)
  console.log('---- Códigos de Nico / Sara (deberían ser 10%) ----');
  const nicosara = await prisma.referralCode.findMany({
    where: { OR: [
      { ownerName: { contains: 'nico', mode: 'insensitive' } },
      { ownerName: { contains: 'sara', mode: 'insensitive' } },
    ] },
    select: { id: true, code: true, ownerName: true, role: true, commissionPercent: true, isActive: true },
  });
  for (const r of nicosara) {
    console.log(`  ${r.ownerName} [${r.role}] code=${r.code} commissionPercent=${r.commissionPercent} activo=${r.isActive}`);
  }

  // ---------- B) CONTEO SUBCUENTAS ----------
  console.log('\n======== B) CONTEO DE SUBCUENTAS (Samuel vs Javier) ========\n');
  const admins = await prisma.user.findMany({
    where: { OR: [
      { email: { contains: 'samuel', mode: 'insensitive' } },
      { email: { contains: 'javier', mode: 'insensitive' } },
      { fullName: { contains: 'samuel', mode: 'insensitive' } },
      { fullName: { contains: 'javier', mode: 'insensitive' } },
    ] },
    select: { id: true, email: true, fullName: true, role: true, whiteLabelId: true, isActive: true },
  });
  for (const u of admins) {
    console.log(`  ${u.fullName ?? '?'} <${u.email}>  role=${u.role}  whiteLabelId=${u.whiteLabelId ?? 'null'}  activo=${u.isActive}`);
  }

  const totalActive = await prisma.tenant.count({ where: { deletedAt: null } });
  const clubifyCount = clubifyId ? await prisma.tenant.count({ where: { deletedAt: null, whiteLabelId: clubifyId } }) : 0;
  const nullCount = await prisma.tenant.count({ where: { deletedAt: null, whiteLabelId: null } });
  const otherCount = totalActive - clubifyCount - nullCount;
  console.log(`\n  Negocios (deletedAt null):`);
  console.log(`    TOTAL todas las marcas: ${totalActive}`);
  console.log(`    Clubify:                ${clubifyCount}`);
  console.log(`    Sin marca (null):       ${nullCount}`);
  console.log(`    Otras marcas:           ${otherCount}`);
  console.log(`\n  → El panel /admin de Clubify muestra Clubify+null = ${clubifyCount + nullCount}.`);
  console.log(`  → Si un usuario ve MÁS, está viendo cross-brand (master admin) o su sesión no está scopeada a Clubify.`);

  // Distribución por marca (para ver las "otras")
  const byBrand = await prisma.tenant.groupBy({
    by: ['whiteLabelId'], where: { deletedAt: null }, _count: { _all: true },
  });
  const wls = await prisma.whiteLabel.findMany({ select: { id: true, name: true } });
  const nameById = Object.fromEntries(wls.map((w) => [w.id, w.name]));
  console.log('\n  Distribución por marca:');
  for (const b of byBrand.sort((a, z) => z._count._all - a._count._all)) {
    console.log(`    ${b.whiteLabelId ? (nameById[b.whiteLabelId] ?? b.whiteLabelId) : 'NULL (sin marca)'}: ${b._count._all}`);
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
