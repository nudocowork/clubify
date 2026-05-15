// Diagnóstico: inspecciona el card.type de un pass específico
// Útil para confirmar por qué el scanner no muestra el botón REDIMIR
// CUPÓN — la causa más probable es que la card sea de un tipo legacy
// (DISCOUNT/GIFT/MULTI) que el scanner ya no maneja.
//
// Uso:
//   railway run --service Postgres-Nq8w -- bash -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node backend/scripts/check-pass-card-type.mjs <customerName|email|passId>'

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error('Usage: node check-pass-card-type.mjs <customerName|email|passId>');
    process.exit(1);
  }

  // Buscar por passId directo, customer.fullName o customer.email
  const passes = await prisma.pass.findMany({
    where: {
      OR: [
        { id: query },
        { customer: { fullName: { contains: query, mode: 'insensitive' } } },
        { customer: { email: { contains: query, mode: 'insensitive' } } },
      ],
    },
    include: {
      card: { select: { id: true, name: true, type: true, rewardText: true, discountPercent: true } },
      customer: { select: { fullName: true, email: true, phone: true } },
      tenant: { select: { slug: true, brandName: true } },
    },
    take: 20,
  });

  if (passes.length === 0) {
    console.log('No se encontraron passes para:', query);
    return;
  }

  for (const p of passes) {
    console.log('─'.repeat(70));
    console.log(`Pass ID: ${p.id}`);
    console.log(`Status: ${p.status}`);
    console.log(`Tenant: ${p.tenant.brandName} (${p.tenant.slug})`);
    console.log(`Customer: ${p.customer.fullName} · ${p.customer.email ?? '(sin email)'}`);
    console.log(`Card: ${p.card.name}`);
    console.log(`  → type: ${p.card.type}`);
    console.log(`  → rewardText: ${p.card.rewardText ?? '(vacío)'}`);
    console.log(`  → discountPercent: ${p.card.discountPercent ?? 0}`);
    console.log(`Stamps: ${p.stampsCount}`);
  }
  console.log('─'.repeat(70));
  console.log(`Total: ${passes.length} pass(es)`);
  console.log('');
  console.log('Si type !== "COUPON", el scanner no muestra el botón REDIMIR.');
  console.log('Tipos que el scanner maneja:');
  console.log('  STAMPS, HYBRID, VISITS, CASHBACK, POINTS, MEMBERSHIP, COUPON');
  console.log('Tipos legacy SIN UI en scanner (intencional):');
  console.log('  DISCOUNT, GIFT, MULTI');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
