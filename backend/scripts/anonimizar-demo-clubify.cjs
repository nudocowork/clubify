/**
 * Anonimiza los CLIENTES del negocio "DEMO CLUBIFY".
 *
 * Ese negocio es el que se le entrega al revisor de Apple, y sus clientes son
 * una mezcla de datos de prueba y personas REALES que probaron el producto
 * (nombres, teléfonos y correos suyos). El revisor no tiene por qué verlos.
 *
 * Solo toca ese tenant. Los datos que importan para la demo —pedidos,
 * tarjetas, sellos, historial— se conservan intactos: únicamente se sustituye
 * la identidad de cada persona.
 *
 * Guarda un respaldo local antes de escribir: los valores originales no se
 * pueden recuperar de otro sitio.
 *
 * Uso:  railway run node scripts/anonimizar-demo-clubify.cjs
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const p = new PrismaClient();

const SLUG = 'demo-clubify';

// Nombres verosímiles: un revisor tiene que ver algo que parezca un negocio
// real, no "Cliente 1, Cliente 2".
const NOMBRES = [
  'Ana Ramírez', 'Carlos Medina', 'Laura Gómez', 'Andrés Torres',
  'Valentina Ruiz', 'Santiago Peña', 'Camila Herrera', 'Mateo Rojas',
  'Isabella Cardona', 'Sebastián Vargas', 'Daniela Castro', 'Tomás Guerrero',
  'Sofía Mejía', 'Emilio Navarro', 'Antonia Salazar', 'Julián Restrepo',
  'Mariana Ospina', 'Nicolás Duarte', 'Gabriela Pardo', 'Felipe Cárdenas',
];

(async () => {
  const t = await p.tenant.findFirst({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!t) {
    console.error(`No existe el negocio ${SLUG}.`);
    process.exit(1);
  }

  const clientes = await p.customer.findMany({
    where: { tenantId: t.id },
    select: { id: true, fullName: true, phone: true, email: true },
    orderBy: { id: 'asc' },
  });
  console.log(`${t.name}: ${clientes.length} clientes`);

  const respaldo = `/tmp/respaldo-clientes-${SLUG}-${Date.now()}.json`;
  fs.writeFileSync(respaldo, JSON.stringify(clientes, null, 2));
  console.log(`Respaldo guardado en ${respaldo}`);

  let n = 0;
  for (const [i, c] of clientes.entries()) {
    const nombre = NOMBRES[i % NOMBRES.length];
    // Prefijo 300 000 00xx: rango de ejemplo, no asignado a nadie real.
    const tel = `+5730000${String(1000 + i).slice(-4)}`;
    const correo = `cliente${String(i + 1).padStart(2, '0')}@ejemplo.com`;
    await p.customer.update({
      where: { id: c.id },
      // El correo solo se pone si el cliente YA tenía uno: inventarle correo a
      // quien no lo tenía cambiaría lo que el negocio puede hacer con él
      // (campañas, recordatorios) y falsearía la demo.
      data: { fullName: nombre, phone: tel, ...(c.email ? { email: correo } : {}) },
    });
    n += 1;
  }

  console.log(`\n${n} clientes anonimizados. Muestra:`);
  const muestra = await p.customer.findMany({
    where: { tenantId: t.id },
    select: { fullName: true, phone: true, email: true },
    take: 5,
  });
  for (const c of muestra) {
    console.log(`  ${c.fullName.padEnd(20)} ${c.phone}  ${c.email ?? '-'}`);
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
