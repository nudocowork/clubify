// Backfill: para customers que ya tienen un COUPON pass COMPLETED pero
// no tienen su stamps card promocionada, dispara el auto-promote
// retroactivamente. Útil después del fix 158d7c0 (auto-create stamps
// card) — los redeems hechos antes no auto-creaban.
//
// Uso (desde raíz del repo o desde backend/):
//   railway run --service Postgres-Nq8w -- bash -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node backend/scripts/backfill-coupon-stamps-promotion.mjs'
//
// Optional: pasar tenantSlug para limitar a un solo negocio:
//   ... backfill-coupon-stamps-promotion.mjs nudocowork

import { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const QR_SECRET = process.env.QR_HMAC_SECRET;
if (!QR_SECRET) {
  console.error('❌ Falta QR_HMAC_SECRET en el environment');
  console.error('   Usá: railway run --service backend -- bash -c "node ..."');
  console.error('   O exportá QR_HMAC_SECRET antes de correr');
  process.exit(1);
}

const tenantSlug = process.argv[2];

async function ensureStampsCardForTenant(tenantId) {
  const existing = await prisma.card.findFirst({
    where: { tenantId, type: 'STAMPS', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (existing) return existing.id;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { brandName: true, primaryColor: true, logoUrl: true },
  });
  const created = await prisma.card.create({
    data: {
      tenantId,
      type: 'STAMPS',
      name: 'Tarjeta de Fidelización',
      description: 'Acumulá sellos en cada compra y canjeá la recompensa.',
      stampsRequired: 10,
      rewardText: 'Recompensa especial',
      primaryColor: tenant?.primaryColor ?? '#22C55E',
      secondaryColor: '#15803D',
      businessName: tenant?.brandName ?? '',
      logoUrl: tenant?.logoUrl ?? null,
      isActive: true,
    },
    select: { id: true },
  });
  console.log(`  ✓ Creé STAMPS card "${created.id}" para tenant ${tenantId}`);
  return created.id;
}

async function issuePass(cardId, customerId, tenantId) {
  const existing = await prisma.pass.findUnique({
    where: { cardId_customerId: { cardId, customerId } },
  });
  if (existing) return { pass: existing, created: false };
  const serial = `CLB-${nanoid(10).toUpperCase()}`;
  const authToken = nanoid(32);
  const placeholderQr = jwt.sign(
    { pid: '__placeholder__', tid: tenantId },
    QR_SECRET,
    { algorithm: 'HS256' },
  );
  const pass = await prisma.pass.create({
    data: { tenantId, cardId, customerId, serialNumber: serial, qrToken: placeholderQr, authToken },
  });
  const finalQr = jwt.sign({ pid: pass.id, tid: tenantId }, QR_SECRET, { algorithm: 'HS256' });
  const updated = await prisma.pass.update({ where: { id: pass.id }, data: { qrToken: finalQr } });
  return { pass: updated, created: true };
}

async function main() {
  console.log('🔍 Buscando coupon passes COMPLETED sin stamps pass promocionada...');
  if (tenantSlug) console.log(`  Filtrado a tenant slug = ${tenantSlug}`);

  const where = {
    status: 'COMPLETED',
    card: { type: { in: ['COUPON', 'DISCOUNT', 'GIFT'] } },
    ...(tenantSlug ? { tenant: { slug: tenantSlug } } : {}),
  };

  const couponPasses = await prisma.pass.findMany({
    where,
    include: {
      card: { select: { id: true, name: true, type: true } },
      customer: { select: { id: true, fullName: true } },
      tenant: { select: { id: true, slug: true, brandName: true } },
    },
  });

  console.log(`  Encontrados: ${couponPasses.length} coupon passes redimidos`);
  console.log('');

  let created = 0;
  let skipped = 0;

  for (const p of couponPasses) {
    const stampsCardId = await ensureStampsCardForTenant(p.tenantId);
    const { pass: stampsPass, created: wasCreated } = await issuePass(
      stampsCardId,
      p.customerId,
      p.tenantId,
    );
    if (wasCreated) {
      created++;
      console.log(`✓ ${p.tenant.brandName} · ${p.customer.fullName}`);
      console.log(`  cupón ${p.card.name} → stamps pass https://soyclubify.com/w/${stampsPass.id}`);
    } else {
      skipped++;
      console.log(`= ${p.tenant.brandName} · ${p.customer.fullName} ya tenía stamps pass`);
    }
  }

  console.log('');
  console.log(`✨ Resumen: ${created} stamps passes creados, ${skipped} ya existían`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
