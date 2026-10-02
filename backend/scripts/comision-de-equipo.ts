/**
 * Configura y/o corre la comisión de equipo con la clase REAL.
 *
 *   --configurar <codeId> [porcentaje] [desde YYYY-MM-DD]   escribe los ajustes
 *   (sin flags)                                             recalcula y muestra
 *
 *   railway run --service Postgres-Nq8w npx ts-node --transpile-only scripts/comision-de-equipo.ts
 */
import { PrismaClient } from '@prisma/client';
import {
  CLAVE_CODIGO,
  CLAVE_DESDE,
  CLAVE_PORCENTAJE,
  ComisionDeEquipoService,
} from '../src/referrals/comision-de-equipo.service';

async function main() {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('No DATABASE_URL');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const args = process.argv.slice(2);
  if (args[0] === '--configurar') {
    const [, codeId, pct = '2', desde = '2026-09-16'] = args;
    const code = await prisma.referralCode.findUnique({ where: { id: codeId }, select: { ownerName: true, code: true } });
    if (!code) throw new Error('Ese código no existe');
    for (const [key, value] of [[CLAVE_CODIGO, codeId], [CLAVE_PORCENTAJE, pct], [CLAVE_DESDE, desde]]) {
      await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    console.log(`Configurada: ${code.ownerName} (${code.code}) · ${pct}% · desde ${desde}`);
  }
  const r = await new ComisionDeEquipoService(prisma as never).recalcular();
  console.log(JSON.stringify(r, null, 1));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
