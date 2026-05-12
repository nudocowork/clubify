#!/usr/bin/env node
// Setea maxLocations correcto para los planes Elite ($50) y Pro ($99)
// en prod, alineándolos con la regla nueva: Elite = 1 ubicación,
// Pro = ilimitado (representado como 100).
//
// Uso:
//   DATABASE_URL='postgresql://...railway public proxy...' \
//     node backend/scripts/fix-plan-max-locations.mjs
//
// Por qué: la regla del producto cambió — los negocios Elite solo
// pueden tener una ubicación con geolocalización; Pro no tiene límite
// práctico. El gate ya está implementado en LocationsService.create()
// vía plan.maxLocations, solo falta que el dato refleje la nueva regla.
//
// Reversible: re-correr el script con valores distintos. Las locations
// existentes NO se borran ni desactivan — si un Elite tenía 3 antes,
// las sigue teniendo (pero no podrá crear nuevas hasta upgrade a Pro).

import { PrismaClient } from '@prisma/client';

const TARGETS = [
  { name: 'Elite', maxLocations: 1 },
  { name: 'Pro', maxLocations: 100 },
];

const prisma = new PrismaClient();

try {
  for (const target of TARGETS) {
    const before = await prisma.plan.findUnique({ where: { name: target.name } });
    if (!before) {
      console.log(`⚠ Plan "${target.name}" no existe en esta DB — skip.`);
      continue;
    }
    console.log(
      `${target.name}: maxLocations ${before.maxLocations} → ${target.maxLocations}`,
    );
    if (before.maxLocations === target.maxLocations) {
      console.log(`  ✓ ya está correcto`);
      continue;
    }
    await prisma.plan.update({
      where: { name: target.name },
      data: { maxLocations: target.maxLocations },
    });
    console.log(`  ✓ actualizado`);
  }
  console.log('\nListo. Verificá en /admin/tenants que el gate funciona:');
  console.log('  - Crear location en un tenant Elite: debe fallar en la 2da');
  console.log('  - Crear location en un tenant Pro: debe permitir múltiples');
} catch (e) {
  console.error('Error:', e);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
