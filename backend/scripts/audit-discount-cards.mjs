#!/usr/bin/env node
/**
 * Audita cards tipo DISCOUNT en prod. Solo lee — no modifica nada.
 *
 * Output:
 * - Total de cards DISCOUNT
 * - Por tenant: cuántas cards + cuántos passes activos
 * - Distribución por status (ACTIVE/COMPLETED/REVOKED)
 *
 * Sirve de paso previo a migrate-discount-to-stamps.mjs.
 *
 * Uso:
 *   railway run --service Postgres-Nq8w -- bash -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/audit-discount-cards.mjs'
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const cards = await prisma.card.findMany({
    where: { type: 'DISCOUNT' },
    select: {
      id: true,
      name: true,
      isActive: true,
      discountPercent: true,
      stampsRequired: true,
      rewardText: true,
      createdAt: true,
      tenant: { select: { slug: true, brandName: true } },
      _count: { select: { passes: true } },
    },
    orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
  });

  console.log(`\n${cards.length} cards DISCOUNT encontradas en prod.\n`);

  if (cards.length === 0) {
    console.log('No hay nada que migrar.');
    return;
  }

  // Group by tenant
  const byTenant = new Map();
  for (const c of cards) {
    const key = c.tenant.slug;
    if (!byTenant.has(key)) {
      byTenant.set(key, { name: c.tenant.brandName, cards: [] });
    }
    byTenant.get(key).cards.push(c);
  }

  for (const [slug, info] of byTenant) {
    console.log(`\n━━ ${info.name} (${slug}) ━━`);
    for (const c of info.cards) {
      const status = c.isActive ? '🟢 activa' : '⚪ inactiva';
      console.log(`  ${status}  ${c.name}`);
      console.log(
        `    ${c.discountPercent ?? '?'}% off | ${c._count.passes} pass(es) | reward: "${c.rewardText || '—'}"`,
      );
    }
  }

  // Stats globales
  const totalPasses = await prisma.pass.count({
    where: { card: { type: 'DISCOUNT' } },
  });
  const activePasses = await prisma.pass.count({
    where: { card: { type: 'DISCOUNT' }, status: 'ACTIVE' },
  });
  const completedPasses = await prisma.pass.count({
    where: { card: { type: 'DISCOUNT' }, status: 'COMPLETED' },
  });
  const revokedPasses = await prisma.pass.count({
    where: { card: { type: 'DISCOUNT' }, status: 'REVOKED' },
  });

  console.log(`\n━━ Passes en cards DISCOUNT ━━`);
  console.log(`  Total:     ${totalPasses}`);
  console.log(`  ACTIVE:    ${activePasses}`);
  console.log(`  COMPLETED: ${completedPasses}`);
  console.log(`  REVOKED:   ${revokedPasses}`);

  console.log(`\nSiguiente paso: migrate-discount-to-stamps.mjs`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
