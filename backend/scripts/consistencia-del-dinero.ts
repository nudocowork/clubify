/**
 * SOLO LECTURA. Corre la validación de consistencia del dinero (la misma que la
 * revisión diaria) y la imprime entera.
 *
 *   railway run --service Postgres-Nq8w npx ts-node --transpile-only scripts/consistencia-del-dinero.ts
 */
import { PrismaClient } from '@prisma/client';
import { revisarConsistencia, ETIQUETA } from '../src/finance/consistencia-del-dinero';

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
  await prisma.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  const lista = await revisarConsistencia(prisma);
  console.log(`${lista.length} inconsistencia(s)`);
  for (const i of lista) console.log(`- ${ETIQUETA[i.tipo].titulo}: ${i.quien} · ${i.detalle}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
