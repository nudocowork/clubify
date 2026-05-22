#!/usr/bin/env node
// Hard-delete de un ReferralCode huérfano que YA está desactivado. Solo borra si:
//   - ownerUserId IS NULL
//   - 0 ReferralUse / 0 ReferralVisit / 0 Commission
//   - 0 SupportMaterial scoped
//   - no es titular de Campaign
//   - no tiene embajadores hijos
//   - isActive=false (debe haber pasado por deactivate-orphan primero)
//
// Default dry-run; --apply para borrar. NO usar en codes con historial —
// para esos usá deactivate-orphan o el merge script.
//
// Uso:
//   DATABASE_URL="..." node scripts/delete-empty-referral-code.mjs --id <id> [--apply]

import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const id = (args[args.indexOf('--id') + 1] ?? '').trim();
const apply = args.includes('--apply');
if (!id) {
  console.error('Uso: --id <referralCodeId> [--apply]');
  process.exit(2);
}

const prisma = new PrismaClient();
try {
  const code = await prisma.referralCode.findUnique({
    where: { id },
    include: {
      ownerOfCampaign: { select: { id: true } },
      ambassadors: { select: { id: true } },
    },
  });
  if (!code) {
    console.error('✗ ReferralCode no encontrado');
    process.exit(1);
  }
  const [uses, visits, materials] = await Promise.all([
    prisma.referralUse.count({ where: { referralCodeId: id } }),
    prisma.referralVisit.count({ where: { referralCodeId: id } }),
    prisma.supportMaterial.count({ where: { scopeInfluencerId: id } }),
  ]);

  console.log(`\nMODO: ${apply ? '⚠️  APPLY (DELETE)' : 'dry-run'}\n`);
  console.log(`id=${code.id}  code=${code.code}  role=${code.role}  isActive=${code.isActive}`);
  console.log(`ownerName=${code.ownerName}  ownerEmail=${code.ownerEmail}  ownerUserId=${code.ownerUserId ?? '(null)'}`);
  console.log(`uses=${uses}  visits=${visits}  materials=${materials}  ambassadors=${code.ambassadors.length}  isOwnerOfCampaign=${!!code.ownerOfCampaign}`);

  const errors = [];
  if (code.isActive) errors.push('isActive=true (corré deactivate-orphan primero)');
  if (code.ownerUserId) errors.push('tiene ownerUserId');
  if (uses > 0) errors.push(`tiene ${uses} ReferralUse`);
  if (visits > 0) errors.push(`tiene ${visits} ReferralVisit`);
  if (materials > 0) errors.push(`tiene ${materials} SupportMaterial`);
  if (code.ambassadors.length > 0) errors.push(`tiene ${code.ambassadors.length} embajadores hijos`);
  if (code.ownerOfCampaign) errors.push('es titular de Campaign');
  if (errors.length) {
    console.error(`\n✗ NO es eliminable: ${errors.join('; ')}. Abortando.`);
    process.exit(1);
  }
  if (!apply) {
    console.log('\n▷ dry-run: re-ejecutá con --apply para borrar.');
    process.exit(0);
  }
  await prisma.referralCode.delete({ where: { id } });
  console.log(`\n✓ DELETE OK — registro borrado físicamente.`);
} catch (e) {
  console.error('✗', e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
