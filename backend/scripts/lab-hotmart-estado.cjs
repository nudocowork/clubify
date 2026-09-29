/**
 * Mueve la propuesta del Lab de Humberto «Modificacion (Aun dice hotmart)»
 * (2026-09-22, marca Sellea) al estado que toque:
 *
 *   node scripts/lab-hotmart-estado.cjs en-pruebas    → IN_TESTING
 *   node scripts/lab-hotmart-estado.cjs implementada  → IMPLEMENTED
 *
 * El trabajo va en su commit (3a6a74b2: los apartados de pagos nombran la
 * pasarela real de cada negocio, no Hotmart). Flujo de Javier: «en pruebas» al
 * desplegarse; «implementada» cuando se verificó en producción.
 *
 * Cambiar el estado NO manda ningún aviso (el SMS del Lab sale solo al CREAR).
 * El id va escrito a mano y se verifica título y autor antes de tocar nada.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/lab-hotmart-estado.cjs en-pruebas
 */
const { PrismaClient } = require('@prisma/client');

const ID = 'cmud7t85k000r9zcsh4sqi0u9';
const TITULO = 'Modificacion (Aun dice hotmart)';
const AUTOR = 'montiel@selleala.com';

const ESTADOS = {
  'en-pruebas': 'IN_TESTING',
  implementada: 'IMPLEMENTED',
};

(async () => {
  const destino = ESTADOS[process.argv[2]];
  if (!destino) {
    console.error('Uso: node scripts/lab-hotmart-estado.cjs en-pruebas|implementada');
    process.exit(1);
  }
  const p = new PrismaClient({
    datasourceUrl: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
  });

  const prop = await p.labProposal.findUnique({
    where: { id: ID },
    select: { title: true, status: true, author: { select: { email: true } } },
  });
  if (!prop) throw new Error('La propuesta no existe.');
  if (prop.title !== TITULO || prop.author.email !== AUTOR) {
    throw new Error(
      `No es la propuesta esperada: "${prop.title}" de ${prop.author.email}.`,
    );
  }
  if (prop.status === destino) {
    console.log(`Ya estaba en ${destino}. Nada que hacer.`);
  } else {
    await p.labProposal.update({
      where: { id: ID },
      data: { status: destino, lastStatusChangedAt: new Date() },
    });
    console.log(`«${TITULO}»: ${prop.status} → ${destino}.`);
  }
  await p.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
