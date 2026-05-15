#!/usr/bin/env node
// Rescate manual: activa el tenant del test ($1 Elite) cuando el webhook
// nunca llegó o no matcheó por email distinto. Setea un marker manual en
// hotmartSubscriberCode para que el lockscreen del frontend se desbloquee.
//
// Uso (desde backend/):
//   DATABASE_URL="$(railway variables --service Postgres-Nq8w --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)" \
//     node scripts/rescue-elite1-tenant.mjs
//
// Idempotente: si el tenant ya está ACTIVE con código, no hace nada.
import { PrismaClient } from '@prisma/client';
const TENANT_ID = '1717e431-2113-4bc5-9402-e44b30a88cbb';
const prisma = new PrismaClient();
try {
  const before = await prisma.tenant.findUnique({
    where: { id: TENANT_ID },
    select: {
      brandName: true,
      status: true,
      hotmartSubscriberCode: true,
      currentPeriodEnd: true,
    },
  });
  if (!before) {
    console.log(`✗ Tenant ${TENANT_ID} no existe`);
    process.exit(1);
  }
  console.log(
    `Antes:  ${before.brandName}  status=${before.status}  subs=${before.hotmartSubscriberCode ?? '(null)'}`,
  );
  if (before.hotmartSubscriberCode && before.status === 'ACTIVE') {
    console.log('✓ Ya está activo, no hago nada');
    process.exit(0);
  }
  // 30 días desde ahora — el próximo cobro real va a actualizar este valor
  // cuando Hotmart eventualmente mande UPDATE_SUBSCRIPTION_CHARGE_DATE.
  const nextCharge = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const after = await prisma.tenant.update({
    where: { id: TENANT_ID },
    data: {
      status: 'ACTIVE',
      hotmartSubscriberCode: `manual-${TENANT_ID.slice(0, 8)}`,
      currentPeriodEnd: nextCharge,
      failedPaymentCount: 0,
      suspendedAt: null,
      lastPaymentAttemptAt: new Date(),
    },
    select: {
      brandName: true,
      status: true,
      hotmartSubscriberCode: true,
      currentPeriodEnd: true,
    },
  });
  console.log(
    `Después: ${after.brandName}  status=${after.status}  subs=${after.hotmartSubscriberCode}  nextCharge=${after.currentPeriodEnd?.toISOString()}`,
  );
  console.log('✓ Rescate completado. Recargá la página del lockscreen.');
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
