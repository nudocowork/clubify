#!/usr/bin/env node
// Migra todos los tenants con plan='Pro' a plan='Elite' y deja registro en consola.
// También migra cualquier Quote con plan=PRO → ELITE (para poder remover el valor
// del enum QuotePlan después).
// Idempotente: si no hay nada que migrar, no hace cambios.
//
// Uso (contra prod):
//   DATABASE_URL="$(railway variables --service Postgres-Nq8w --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)" \
//     node scripts/migrate-pro-to-elite.mjs
//
// Flags:
//   --dry-run    Solo reporta, no escribe.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL no seteada');
    process.exit(1);
  }

  console.log(`→ Migración Pro → Elite ${DRY_RUN ? '(DRY RUN)' : ''}\n`);

  const elite = await prisma.plan.findUnique({ where: { name: 'Elite' } });
  if (!elite) {
    console.error('✗ No existe Plan "Elite" en la DB. Abortando.');
    process.exit(1);
  }
  console.log(`✓ Plan Elite encontrado (id=${elite.id})`);

  const pro = await prisma.plan.findUnique({ where: { name: 'Pro' } });
  if (!pro) {
    console.log('• No existe Plan "Pro" en la DB — nada que migrar a nivel Plan.');
  } else {
    console.log(`✓ Plan Pro encontrado (id=${pro.id})`);

    const proTenants = await prisma.tenant.findMany({
      where: { planId: pro.id },
      select: { id: true, slug: true, name: true, status: true },
    });
    console.log(`\nTenants con plan Pro: ${proTenants.length}`);
    for (const t of proTenants) {
      console.log(`  - ${t.slug} (${t.name}) · status=${t.status}`);
    }

    if (proTenants.length > 0 && !DRY_RUN) {
      const r = await prisma.tenant.updateMany({
        where: { planId: pro.id },
        data: { planId: elite.id },
      });
      console.log(`✓ Migrados ${r.count} tenant(s) Pro → Elite`);
    } else if (proTenants.length > 0) {
      console.log('(dry-run: no se aplicaron cambios)');
    }
  }

  // ----- Quotes ----- //
  const proQuotes = await prisma.quote.count({ where: { plan: 'PRO' } });
  console.log(`\nQuotes con plan=PRO: ${proQuotes}`);
  if (proQuotes > 0 && !DRY_RUN) {
    const r = await prisma.quote.updateMany({
      where: { plan: 'PRO' },
      data: { plan: 'ELITE' },
    });
    console.log(`✓ Migradas ${r.count} cotización(es) PRO → ELITE`);
  } else if (proQuotes > 0) {
    console.log('(dry-run: no se aplicaron cambios)');
  }

  // ----- Resumen final ----- //
  console.log('\n--- estado final ---');
  const counts = await prisma.tenant.groupBy({
    by: ['planId'],
    _count: { _all: true },
  });
  for (const c of counts) {
    const p = await prisma.plan.findUnique({ where: { id: c.planId } });
    console.log(`  plan=${p?.name ?? '?'}: ${c._count._all} tenant(s)`);
  }

  console.log('\n✓ Done.');
  if (pro && !DRY_RUN) {
    console.log('\nNOTA: el row Plan "Pro" sigue existiendo en la tabla Plan');
    console.log('(no se borra para mantener la integridad referencial de historicos).');
    console.log('Si querés borrarlo después de confirmar que no hay tenants asignados:');
    console.log('  DELETE FROM "Plan" WHERE name=\'Pro\';');
  }
}

main()
  .catch((e) => {
    console.error('✗ Error:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
