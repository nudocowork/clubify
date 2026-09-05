/**
 * SOLO LECTURA: en qué formato están guardados los teléfonos de los clientes.
 *
 * Decide si «Mis pedidos» puede buscar por la COLA del número (`endsWith`) sin
 * dejar fuera a nadie. Si hay teléfonos con espacios o guiones DENTRO del
 * número, endsWith no los encontraría y sería peor el remedio.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const clientes = await p.customer.findMany({
      where: { phone: { not: null } },
      select: { phone: true },
      take: 20000,
    });
    let limpios = 0;
    let conEspaciosDentro = 0;
    const ejemplos = [];
    for (const c of clientes) {
      const t = (c.phone || '').trim();
      // «+57 3150621706» = prefijo, UN espacio, y dígitos seguidos.
      if (/^\+?\d{1,4} ?\d{6,15}$/.test(t)) limpios++;
      else {
        conEspaciosDentro++;
        if (ejemplos.length < 8) {
          ejemplos.push(t.replace(/\d/g, '#')); // sin datos personales
        }
      }
    }
    console.log(`teléfonos revisados: ${clientes.length}`);
    console.log(`  formato simple (prefijo + número seguido): ${limpios}`);
    console.log(`  con separadores dentro: ${conEspaciosDentro}`);
    if (ejemplos.length) console.log('  formas raras:', ejemplos.join(' | '));
  } finally {
    await p.$disconnect();
  }
})();
