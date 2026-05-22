#!/usr/bin/env node
// Lista los ReferralUse de un ReferralCode con info de pago y comisiones.
// Read-only, usado para diagnosticar si hay comisiones retroactivas que crear.
//
// Uso:
//   DATABASE_URL="..." node scripts/inspect-uses-of-code.mjs --code-id <id>

import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const codeId = (args[args.indexOf('--code-id') + 1] ?? '').trim();
if (!codeId) {
  console.error('Uso: --code-id <referralCodeId>');
  process.exit(2);
}

const prisma = new PrismaClient();
try {
  const code = await prisma.referralCode.findUnique({
    where: { id: codeId },
    select: { id: true, code: true, role: true, ownerName: true, commissionPercent: true },
  });
  if (!code) {
    console.error('✗ ReferralCode no encontrado');
    process.exit(1);
  }
  console.log(`\nReferralCode ${code.code} (${code.role}) — ${code.ownerName}  pct=${code.commissionPercent}\n`);

  const uses = await prisma.referralUse.findMany({
    where: { referralCodeId: codeId },
    include: {
      tenant: {
        select: {
          id: true,
          brandName: true,
          status: true,
          currentPeriodEnd: true,
          hotmartSubscriberCode: true,
          plan: { select: { name: true, priceMonthly: true } },
        },
      },
      commissions: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, amount: true, status: true, createdAt: true, paidAt: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!uses.length) {
    console.log('(sin ReferralUse)');
    process.exit(0);
  }

  uses.forEach((u, i) => {
    console.log('─'.repeat(80));
    console.log(`[${i + 1}] useId=${u.id}`);
    console.log(`    tenant: ${u.tenant?.brandName ?? '—'}  status=${u.tenant?.status ?? '—'}  plan=${u.tenant?.plan?.name ?? '—'} ($${u.tenant?.plan?.priceMonthly ?? 0}/mes)`);
    console.log(`    tenant currentPeriodEnd: ${u.tenant?.currentPeriodEnd?.toISOString() ?? '(null)'}`);
    console.log(`    tenant hotmartSubscriberCode: ${u.tenant?.hotmartSubscriberCode ?? '(null)'}`);
    console.log(`    use.status=${u.status}  signedUpAt=${u.createdAt.toISOString()}  convertedAt=${u.convertedAt?.toISOString() ?? '(null)'}`);
    console.log(`    viaSlug=${u.viaSlug ?? '—'}  utmSource=${u.utmSource ?? '—'}`);
    console.log(`    commissions: ${u.commissions.length}`);
    u.commissions.forEach((c) => {
      console.log(
        `      - $${c.amount}  ${c.status}  createdAt=${c.createdAt.toISOString()}  paidAt=${c.paidAt?.toISOString() ?? '—'}`,
      );
    });
  });
  console.log('');
} catch (e) {
  console.error('✗', e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
