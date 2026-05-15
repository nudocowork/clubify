#!/usr/bin/env node
// Diagnóstico: ¿el tenant del test ($1 Elite) recibió el webhook?
// Uso: railway run node scripts/check-elite1-tenant.mjs
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const users = await prisma.user.findMany({
    where: { email: { contains: 'jhonarias888+elite1', mode: 'insensitive' } },
    select: {
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      tenant: {
        select: {
          id: true,
          slug: true,
          brandName: true,
          status: true,
          hotmartSubscriberCode: true,
          hotmartTransactionId: true,
          currentPeriodEnd: true,
          failedPaymentCount: true,
          lastPaymentAttemptAt: true,
          createdAt: true,
          plan: { select: { name: true, priceMonthly: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  if (!users.length) {
    console.log('✗ No se encontró ningún usuario con email jhonarias888+elite1@...');
    console.log('  Listando los últimos 10 usuarios para ubicar el correcto:');
    const recent = await prisma.user.findMany({
      where: { email: { contains: 'jhonarias', mode: 'insensitive' } },
      select: { email: true, createdAt: true, tenant: { select: { brandName: true, status: true, hotmartSubscriberCode: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    for (const u of recent) {
      console.log(`  - ${u.email}  brand=${u.tenant?.brandName}  status=${u.tenant?.status}  subs=${u.tenant?.hotmartSubscriberCode ?? '(null)'}`);
    }
  } else {
    for (const u of users) {
      const t = u.tenant;
      console.log(`\nUsuario: ${u.email}  role=${u.role}  active=${u.isActive}`);
      console.log(`  Creado: ${u.createdAt.toISOString()}`);
      if (!t) {
        console.log('  ✗ Sin tenant asociado');
        continue;
      }
      console.log(`  Tenant: ${t.brandName} (slug=${t.slug}, id=${t.id})`);
      console.log(`    plan:                 ${t.plan?.name ?? '(none)'} ($${t.plan?.priceMonthly})`);
      console.log(`    status:               ${t.status}`);
      console.log(`    hotmartSubscriberCode: ${t.hotmartSubscriberCode ?? '✗ NULL (lockscreen sigue)'}`);
      console.log(`    hotmartTransactionId:  ${t.hotmartTransactionId ?? '(null)'}`);
      console.log(`    currentPeriodEnd:     ${t.currentPeriodEnd?.toISOString() ?? '(null)'}`);
      console.log(`    failedPaymentCount:   ${t.failedPaymentCount}`);
      console.log(`    lastPaymentAttemptAt: ${t.lastPaymentAttemptAt?.toISOString() ?? '(null)'}`);
    }
  }
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
