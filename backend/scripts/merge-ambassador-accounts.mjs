#!/usr/bin/env node
// Merge de dos ReferralCode (embajadores) duplicados.
//
// Mueve TODOS los ReferralUse (clientes referidos) y ReferralVisit (clicks)
// del source al target, en una transacción atómica. Las Commission viajan
// junto a sus ReferralUse (relación referralUseId → referralCodeId).
//
// El source queda desactivado (isActive=false, approvedAt=null, source con
// marker 'merged_into:<targetId>'). NO se borra para preservar auditoría.
//
// Uso (desde backend/):
//   # Dry-run (default): muestra qué movería sin tocar nada
//   DATABASE_URL="..." node scripts/merge-ambassador-accounts.mjs \
//     --source <referralCodeId-a-eliminar> \
//     --target <referralCodeId-a-conservar>
//
//   # Aplicar de verdad (requiere --apply)
//   DATABASE_URL="..." node scripts/merge-ambassador-accounts.mjs \
//     --source <id> --target <id> --apply
//
// Validaciones de seguridad:
//   - Ambos códigos existen.
//   - source != target.
//   - Source role === AMBASSADOR (refuse merge de INFLUENCER/SOCIO).
//   - Source NO es owner de Campaign (un Campaign.ownerCodeId quedaría huérfano).
//   - Si --expect-target-parent <id>, valida target.parentCodeId === ese id
//     (sirve para "confirmar que target está asociado al influencer Juan").

import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
function arg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : null;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const sourceId = arg('source');
const targetId = arg('target');
const expectTargetParent = arg('expect-target-parent');
const apply = hasFlag('apply');

if (!sourceId || !targetId) {
  console.error('Uso: --source <id> --target <id> [--expect-target-parent <id>] [--apply]');
  process.exit(2);
}
if (sourceId === targetId) {
  console.error('✗ source y target son el mismo id');
  process.exit(2);
}

const prisma = new PrismaClient();

async function summarize(id) {
  const [code, usesCount, visitsCount, commissions] = await Promise.all([
    prisma.referralCode.findUnique({
      where: { id },
      include: {
        parentCode: { select: { id: true, code: true, ownerName: true, role: true } },
        ownerOfCampaign: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
      },
    }),
    prisma.referralUse.count({ where: { referralCodeId: id } }),
    prisma.referralVisit.count({ where: { referralCodeId: id } }),
    prisma.commission.findMany({
      where: { referralUse: { referralCodeId: id } },
      select: { amount: true, status: true },
    }),
  ]);
  if (!code) return null;
  const sum = (st) =>
    commissions
      .filter((c) => (st ? c.status === st : true))
      .reduce((s, c) => s + Number(c.amount), 0);
  return {
    code,
    usesCount,
    visitsCount,
    commissionsCount: commissions.length,
    commissionsTotalUsd: Math.round(sum() * 100) / 100,
    commissionsPaidUsd: Math.round(sum('PAID') * 100) / 100,
    commissionsPendingUsd: Math.round(sum('PENDING') * 100) / 100,
  };
}

function printSummary(label, s) {
  if (!s) {
    console.log(`✗ ${label}: NO ENCONTRADO`);
    return;
  }
  const c = s.code;
  console.log(`${label}:`);
  console.log(`  id=${c.id}  code=${c.code}  role=${c.role}  isActive=${c.isActive}`);
  console.log(`  ownerName=${c.ownerName}  ownerEmail=${c.ownerEmail}  ownerUserId=${c.ownerUserId ?? '(null)'}`);
  console.log(
    `  parent: ${c.parentCode ? `${c.parentCode.ownerName} [${c.parentCode.code}] (${c.parentCode.role})` : '— (directo / sin parent)'}`,
  );
  console.log(`  campaign: ${c.campaign ? `${c.campaign.name} (${c.campaign.id})` : '— (sin campaña)'}`);
  console.log(`  ownerOfCampaign: ${c.ownerOfCampaign ? `${c.ownerOfCampaign.name} (${c.ownerOfCampaign.id})` : '— (no es titular)'}`);
  console.log(`  clientes (uses)=${s.usesCount}  visitas=${s.visitsCount}  comisiones=${s.commissionsCount}`);
  console.log(`  comisiones total=$${s.commissionsTotalUsd}  pagadas=$${s.commissionsPaidUsd}  pendientes=$${s.commissionsPendingUsd}`);
}

try {
  console.log(`\nMODO: ${apply ? '⚠️  APPLY (los cambios se persisten)' : 'dry-run (sin cambios)'}\n`);

  const before = {
    source: await summarize(sourceId),
    target: await summarize(targetId),
  };

  printSummary('SOURCE (a desactivar)', before.source);
  console.log('');
  printSummary('TARGET (a conservar)', before.target);
  console.log('');

  if (!before.source || !before.target) {
    console.error('✗ Uno de los ReferralCode no existe. Abortando.');
    process.exit(1);
  }
  if (before.source.code.role !== 'AMBASSADOR') {
    console.error(`✗ Source role=${before.source.code.role}; este script solo mergea AMBASSADOR. Abortando.`);
    process.exit(1);
  }
  if (before.source.code.ownerOfCampaign) {
    console.error('✗ Source es titular de una Campaign (ownerCodeId). Mergearlo dejaría la campaña huérfana. Abortando.');
    process.exit(1);
  }
  if (expectTargetParent && before.target.code.parentCodeId !== expectTargetParent) {
    console.error(
      `✗ target.parentCodeId=${before.target.code.parentCodeId} ≠ --expect-target-parent ${expectTargetParent}. Abortando.`,
    );
    process.exit(1);
  }
  if (before.source.code.ownerEmail !== before.target.code.ownerEmail) {
    console.warn(
      `⚠ ownerEmail distinto: source="${before.source.code.ownerEmail}" target="${before.target.code.ownerEmail}". ` +
        `Continuando (válido si se decide unificar manualmente).`,
    );
  }

  const plan = {
    usesToMove: before.source.usesCount,
    visitsToMove: before.source.visitsCount,
    commissionsToMove: before.source.commissionsCount,
    sourceWillBeDeactivated: before.source.code.isActive,
  };

  console.log('PLAN:');
  console.log(`  • Mover ${plan.usesToMove} ReferralUse → target`);
  console.log(`  • Mover ${plan.visitsToMove} ReferralVisit → target`);
  console.log(`  • Las ${plan.commissionsToMove} Commission viajan con sus ReferralUse (no requieren UPDATE directo)`);
  console.log(`  • Desactivar source (isActive=false, source='merged_into:${targetId}')`);
  console.log('');

  if (!apply) {
    console.log('▷ dry-run: nada se modificó. Re-ejecutá con --apply para persistir.');
    process.exit(0);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // APPLY — transacción atómica
  // ──────────────────────────────────────────────────────────────────────────
  const result = await prisma.$transaction(async (tx) => {
    const usesUpdated = await tx.referralUse.updateMany({
      where: { referralCodeId: sourceId },
      data: { referralCodeId: targetId },
    });
    const visitsUpdated = await tx.referralVisit.updateMany({
      where: { referralCodeId: sourceId },
      data: { referralCodeId: targetId },
    });
    const sourceAfter = await tx.referralCode.update({
      where: { id: sourceId },
      data: {
        isActive: false,
        source: `merged_into:${targetId}`,
        // No tocamos approvedAt/ownerUserId para preservar auditoría histórica.
      },
    });
    return { usesUpdated: usesUpdated.count, visitsUpdated: visitsUpdated.count, sourceAfter };
  });

  console.log(`✓ Movidos ${result.usesUpdated} ReferralUse y ${result.visitsUpdated} ReferralVisit.`);
  console.log(`✓ Source desactivado: isActive=${result.sourceAfter.isActive}  source="${result.sourceAfter.source}"\n`);

  // Reporte final
  const after = {
    source: await summarize(sourceId),
    target: await summarize(targetId),
  };
  console.log('═'.repeat(80));
  console.log('REPORTE FINAL');
  console.log('═'.repeat(80));
  printSummary('SOURCE (desactivado)', after.source);
  console.log('');
  printSummary('TARGET (consolidado)', after.target);
  console.log('');
  console.log(
    `Δ clientes target: ${before.target.usesCount} → ${after.target.usesCount}` +
      `  (transferidos: ${after.target.usesCount - before.target.usesCount})`,
  );
  console.log(
    `Δ visitas target:  ${before.target.visitsCount} → ${after.target.visitsCount}` +
      `  (transferidas: ${after.target.visitsCount - before.target.visitsCount})`,
  );
  console.log(
    `Δ comisiones target: ${before.target.commissionsCount} → ${after.target.commissionsCount}` +
      `  (transferidas: ${after.target.commissionsCount - before.target.commissionsCount})`,
  );
  console.log('');
  console.log('✓ Merge completado.');
} catch (e) {
  console.error('✗', e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
