#!/usr/bin/env node
// Limpia el Setting branding.appLogoUrl en prod.
// Mismo patrón que clear-branding-favicon.mjs — el panel/sidebar/login/landing
// caen al cascade default que usa /clubify-logo.png (lockup nuevo) y
// /icons/icon-256.png (mark) vía Logo.tsx.
// Reversible: re-subir logo desde /admin/branding.

import { PrismaClient } from '@prisma/client';

const KEY = 'branding.appLogoUrl';
const prisma = new PrismaClient();

try {
  const before = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!before) {
    console.log(`✓ No existe row "${KEY}". Nada que hacer.`);
    process.exit(0);
  }
  console.log(`Estado actual: ${KEY} = ${JSON.stringify(before.value)}`);
  const after = await prisma.setting.update({
    where: { key: KEY },
    data: { value: '' },
  });
  console.log(`✓ Limpiado: ${KEY} = "" (visible como null en API)`);
  console.log(`  updatedAt: ${after.updatedAt?.toISOString?.() ?? '-'}`);
} catch (e) {
  console.error('✗ Falló:', e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
