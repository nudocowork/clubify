/**
 * SOLO LECTURA. Quién vendió un negocio y qué comisiones generó, con el ROL y
 * el % de cada uno: sirve para ver si el reparto embajador / influencer quedó
 * bien (directa del embajador + 5 % indirecto del influencer de arriba).
 *
 * Caso MOTILART (2026-10-16): tiene embajador e influencer y solo cobró el
 * influencer, 25 % de $50.
 *
 *   railway run --service backend --environment production node scripts/diag-comisiones-negocio.cjs --negocio motilart
 */
const { PrismaClient } = require('@prisma/client');

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const nombre = arg('negocio');
if (!nombre) {
  console.error('Uso: --negocio <parte del nombre>');
  process.exit(1);
}
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

(async () => {
  const tenants = await p.tenant.findMany({
    where: { brandName: { contains: nombre, mode: 'insensitive' }, deletedAt: null },
    select: { id: true, brandName: true, planPeriodicity: true, createdAt: true },
  });
  for (const t of tenants) {
    console.log(`\n══ ${t.brandName} · ${t.planPeriodicity ?? '—'} · alta ${f(t.createdAt)}`);
    const usos = await p.referralUse.findMany({
      where: { tenantId: t.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, status: true, createdAt: true, viaSlug: true, utmSource: true,
        referralCode: {
          select: {
            code: true, ownerName: true, role: true, commissionPercent: true,
            parentCode: { select: { code: true, ownerName: true, role: true, commissionPercent: true } },
          },
        },
      },
    });
    console.log('  Quién aparece como vendedor:');
    for (const u of usos) {
      const c = u.referralCode;
      console.log(
        `    · ${c.ownerName} (${c.code}) — ${c.role}, ${Number(c.commissionPercent)} %` +
          `${c.parentCode ? ` · su superior: ${c.parentCode.ownerName} (${c.parentCode.code}, ${c.parentCode.role}, ${Number(c.parentCode.commissionPercent)} %)` : ' · sin superior'}` +
          ` · registrado ${f(u.createdAt)} · ${u.status}${u.utmSource ? ` · origen ${u.utmSource}` : ''}`,
      );
    }
    const comisiones = await p.commission.findMany({
      where: { referralUseId: { in: usos.map((u) => u.id) } },
      orderBy: [{ businessDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        amount: true, status: true, businessDate: true, createdAt: true, baseAmountUsd: true, appliedPercent: true,
        notes: true, referralUseId: true,
        recipientCode: { select: { ownerName: true, role: true } },
      },
    });
    const ingresos = await p.incomeRecord.findMany({
      where: { tenantId: t.id },
      orderBy: { saleDate: 'asc' },
      select: { saleDate: true, gateway: true, grossUsd: true, status: true },
    });
    console.log('  Cobros:');
    for (const i of ingresos) console.log(`    ${f(i.saleDate)} ${i.gateway} $${Number(i.grossUsd)} ${i.status}`);
    console.log('  Comisiones:');
    for (const c of comisiones) {
      const deUso = usos.find((u) => u.id === c.referralUseId)?.referralCode?.ownerName;
      console.log(
        `    ${f(c.businessDate ?? c.createdAt)} $${Number(c.amount)} ${c.status} → ${c.recipientCode?.ownerName ?? '?'} (${c.recipientCode?.role ?? '?'})` +
          `${c.appliedPercent != null ? ` · ${Number(c.appliedPercent)} % de $${Number(c.baseAmountUsd)}` : ''}` +
          ` · colgada del registro de ${deUso ?? '?'}${c.notes ? ` · ${String(c.notes).slice(0, 80)}` : ''}`,
      );
    }
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
