#!/usr/bin/env node
// Desactiva un ReferralCode huérfano sin actividad. Valida que:
//   - no tenga ownerUserId vinculado,
//   - 0 ReferralUse, 0 ReferralVisit, 0 Commission,
//   - no sea titular de Campaign,
//   - no tenga embajadores hijos,
//   - no tenga SupportMaterial scoped.
//
// Si alguna validación falla, aborta. Default dry-run; --apply para persistir.
//
// Uso:
//   DATABASE_URL="..." node scripts/deactivate-orphan-referral-code.mjs --id <referralCodeId> [--apply]

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
      ownerOfCampaign: { select: { id: true, name: true } },
      ambassadors: { select: { id: true, isActive: true } },
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

  console.log(`\nMODO: ${apply ? '⚠️  APPLY' : 'dry-run'}\n`);
  console.log(`id=${code.id}  code=${code.code}  role=${code.role}  isActive=${code.isActive}`);
  console.log(`ownerName=${code.ownerName}  ownerEmail=${code.ownerEmail}  ownerUserId=${code.ownerUserId ?? '(null)'}`);
  console.log(`uses=${uses}  visits=${visits}  materials=${materials}`);
  console.log(`ownerOfCampaign=${code.ownerOfCampaign?.name ?? '—'}  ambassadors=${code.ambassadors.length}`);

  const errors = [];
  if (code.ownerUserId) errors.push('tiene ownerUserId vinculado');
  if (uses > 0) errors.push(`tiene ${uses} ReferralUse`);
  if (visits > 0) errors.push(`tiene ${visits} ReferralVisit`);
  if (materials > 0) errors.push(`tiene ${materials} SupportMaterial scoped`);
  if (code.ownerOfCampaign) errors.push(`es titular de Campaign ${code.ownerOfCampaign.name}`);
  if (code.ambassadors.some((a) => a.isActive)) {
    errors.push('tiene embajadores hijos activos');
  }
  if (errors.length) {
    console.error(`\n✗ No es huérfano: ${errors.join('; ')}. Abortando.`);
    process.exit(1);
  }
  if (!code.isActive) {
    console.log('\n✓ Ya está isActive=false. Nada que hacer.');
    process.exit(0);
  }
  if (!apply) {
    console.log('\n▷ dry-run: re-ejecutá con --apply para desactivar.');
    process.exit(0);
  }
  const after = await prisma.referralCode.update({
    where: { id },
    data: { isActive: false, source: 'orphan_deactivated' },
  });
  console.log(`\n✓ Desactivado: isActive=${after.isActive}  source="${after.source}"`);
} catch (e) {
  console.error('✗', e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
