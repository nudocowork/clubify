#!/usr/bin/env node
// Limpia el Setting branding.faviconUrl en prod.
// Uso:
//   DATABASE_URL='postgresql://...railway public proxy...' \
//     node backend/scripts/clear-branding-favicon.mjs
//
// Por qué: el frontend prioriza branding.faviconUrl sobre el cascade default
// (/icons/icon.svg + favicon.ico + PNGs). Limpiando el setting el cascade
// queda activo y Clubify muestra el favicon nuevo (C en gradient).
//
// Reversible: re-subir favicon desde /admin/branding cuando quieras.

import { PrismaClient } from '@prisma/client';

const KEY = 'branding.faviconUrl';

const prisma = new PrismaClient();

try {
  const before = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!before) {
    console.log(`✓ No existe row "${KEY}". Nada que hacer.`);
    process.exit(0);
  }
  console.log(`Estado actual: ${KEY} = ${JSON.stringify(before.value)}`);
  // Empty string es interpretado por SettingsService.norm() como null,
  // así que NO borramos el row — solo vaciamos el value para mantener
  // compat con el path de upsert que usa setBranding().
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
