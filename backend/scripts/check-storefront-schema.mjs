#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name ILIKE '%torefront%'
  `);
  console.log('Storefront tables:', tables);

  const allCols = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_name='Storefront' OR table_name='storefront'
    ORDER BY ordinal_position
  `);
  console.log('\nStorefront columns:');
  console.log(allCols);

  const enums = await prisma.$queryRawUnsafe(`
    SELECT t.typname, e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    ORDER BY t.typname, e.enumsortorder
  `);
  console.log('\nTodos los enums:');
  for (const e of enums) console.log(`  ${e.typname} → ${e.enumlabel}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
