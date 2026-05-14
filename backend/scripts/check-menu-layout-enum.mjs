#!/usr/bin/env node
// Diagnóstico: averigua qué tipo es el column Storefront.menuLayout en
// prod y qué valores acepta. La idea es entender por qué Prisma dice
// que el enum "MenuLayout" no existe pero el backend funciona.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Qué columnas tiene Storefront y de qué tipo
  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_name = 'Storefront' AND column_name = 'menuLayout'
  `);
  console.log('Storefront.menuLayout column:');
  console.log(cols);

  // 2. Lista todos los enums del schema
  const enums = await prisma.$queryRawUnsafe(`
    SELECT t.typname, e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname ILIKE '%menu%' OR t.typname ILIKE '%layout%'
    ORDER BY t.typname, e.enumsortorder
  `);
  console.log('\nEnums encontrados con "menu" o "layout":');
  console.log(enums);

  // 3. Verificar columnas nuevas de Category
  const catCols = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'Category' AND column_name IN ('tagline', 'coverConfig')
  `);
  console.log('\nCategory.tagline + coverConfig:');
  console.log(catCols);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
