#!/usr/bin/env node
// Auditoría: encuentra ReferralCodes duplicados por ownerEmail.
//
// Uso (desde backend/):
//   DATABASE_URL="..." node scripts/audit-duplicate-ambassadors.mjs
//   DATABASE_URL="..." node scripts/audit-duplicate-ambassadors.mjs --email santiago@x.com
//   DATABASE_URL="..." node scripts/audit-duplicate-ambassadors.mjs --name santiago
//
// No modifica nada. Solo lista.

import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
function arg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : null;
}

const filterEmail = arg('email')?.toLowerCase().trim() ?? null;
const filterName = arg('name')?.toLowerCase().trim() ?? null;

const prisma = new PrismaClient();

function fmt(n, w = 4) {
  return String(n ?? 0).padStart(w);
}

async function detailFor(code) {
  const [usesCount, visitsCount, commissions, parent] = await Promise.all([
    prisma.referralUse.count({ where: { referralCodeId: code.id } }),
    prisma.referralVisit.count({ where: { referralCodeId: code.id } }),
    prisma.commission.findMany({
      where: { referralUse: { referralCodeId: code.id } },
      select: { amount: true, status: true },
    }),
    code.parentCodeId
      ? prisma.referralCode.findUnique({
          where: { id: code.parentCodeId },
          select: { id: true, code: true, ownerName: true, role: true },
        })
      : null,
  ]);
  const sum = (st) =>
    commissions
      .filter((c) => (st ? c.status === st : true))
      .reduce((s, c) => s + Number(c.amount), 0);
  return {
    code,
    usesCount,
    visitsCount,
    commissionsTotalUsd: Math.round(sum() * 100) / 100,
    commissionsPaidUsd: Math.round(sum('PAID') * 100) / 100,
    commissionsPendingUsd: Math.round(sum('PENDING') * 100) / 100,
    parent,
  };
}

function printGroupHeader(email, count) {
  console.log('');
  console.log('─'.repeat(80));
  console.log(`✦ ownerEmail="${email}"  (${count} registros)`);
  console.log('─'.repeat(80));
}

function printCodeDetail(d, idx) {
  const c = d.code;
  const parentDesc = d.parent
    ? `${d.parent.ownerName} [${d.parent.code}] (${d.parent.role})`
    : '— (sin parent / directo empresa)';
  console.log(
    `\n  [${idx + 1}] id=${c.id}`,
  );
  console.log(`      code=${c.code}  slug=${c.slug ?? '—'}  role=${c.role}`);
  console.log(`      ownerName=${c.ownerName}  ownerUserId=${c.ownerUserId ?? '(null)'}`);
  console.log(`      parent: ${parentDesc}`);
  console.log(`      campaignId=${c.campaignId ?? '(null)'}`);
  console.log(`      isActive=${c.isActive}  approvedAt=${c.approvedAt?.toISOString() ?? '(null)'}`);
  console.log(`      createdAt=${c.createdAt.toISOString()}`);
  console.log(
    `      clientes(uses)=${fmt(d.usesCount)}  visitas=${fmt(d.visitsCount)}  ` +
      `comisiones: total=$${d.commissionsTotalUsd}  pagadas=$${d.commissionsPaidUsd}  pendientes=$${d.commissionsPendingUsd}`,
  );
  if (c.source) console.log(`      source=${c.source}`);
}

try {
  // 1) Buscar candidatos
  const where = {};
  if (filterEmail) where.ownerEmail = filterEmail;
  if (filterName)
    where.ownerName = { contains: filterName, mode: 'insensitive' };

  const allCodes = await prisma.referralCode.findMany({
    where,
    orderBy: [{ ownerEmail: 'asc' }, { createdAt: 'asc' }],
  });

  // 2) Agrupar por email lowercase
  const groups = new Map();
  for (const c of allCodes) {
    const k = (c.ownerEmail ?? '').toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }

  // 3) Filtrar a grupos duplicados (>1) salvo que el filtro especifique algo
  const dupGroups = [];
  for (const [email, list] of groups.entries()) {
    if (list.length > 1 || filterEmail || filterName) {
      dupGroups.push({ email, list });
    }
  }

  if (dupGroups.length === 0) {
    console.log('✓ No se encontraron ReferralCodes duplicados por ownerEmail.');
    process.exit(0);
  }

  console.log(`Encontrados ${dupGroups.length} grupo(s) con ${dupGroups.reduce((s, g) => s + g.list.length, 0)} registros totales.\n`);

  for (const g of dupGroups) {
    printGroupHeader(g.email, g.list.length);
    const details = [];
    for (const c of g.list) details.push(await detailFor(c));
    details.forEach((d, i) => printCodeDetail(d, i));

    // Sugerencia: si hay 1 con parent y 1 sin, recomendar conservar el que tiene parent.
    const withParent = details.filter((d) => d.code.parentCodeId);
    const withoutParent = details.filter((d) => !d.code.parentCodeId);
    if (withParent.length === 1 && withoutParent.length === 1) {
      console.log('\n  → Sugerencia: conservar el que tiene parent influencer y mergear el directo:');
      console.log(`     --source ${withoutParent[0].code.id} --target ${withParent[0].code.id}`);
    }
  }
  console.log('');
} catch (e) {
  console.error('✗', e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
