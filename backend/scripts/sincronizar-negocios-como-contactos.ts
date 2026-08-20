/**
 * Trae los NEGOCIOS de una marca a su lista de Contactos de Email Marketing.
 *
 * Usa el servicio real (`MktContactService.syncTenants`), no una copia: pasa por
 * el resolver de identidad, que es lo que protege los índices únicos parciales
 * de producción. Es idempotente: correrlo dos veces reporta 0 y 0.
 *
 * Uso:  railway run npx ts-node scripts/sincronizar-negocios-como-contactos.ts <slugMarca> [--aplicar]
 *
 * Sin --aplicar solo dice cuántos negocios hay y cuántos tienen con qué
 * escribirles. No escribe nada.
 */
import { PrismaService } from '../src/common/prisma/prisma.service';
import { MktContactService } from '../src/marketing/mkt-contact.service';

const slug = process.argv[2];
const APLICAR = process.argv.includes('--aplicar');

async function main() {
  if (!slug) {
    console.error('Uso: sincronizar-negocios-como-contactos.ts <slugMarca> [--aplicar]');
    process.exit(1);
  }
  const prisma = new PrismaService();
  await prisma.$connect();

  const wl = await prisma.whiteLabel.findFirst({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!wl) {
    console.error(`No existe la marca "${slug}".`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const negocios = await prisma.tenant.count({
    where: { whiteLabelId: wl.id, deletedAt: null },
  });
  const contactables = await prisma.tenant.count({
    where: {
      whiteLabelId: wl.id,
      deletedAt: null,
      OR: [{ email: { not: '' } }, { phone: { not: null } }, { whatsappPhone: { not: null } }],
    },
  });
  const yaHay = await prisma.mktContact.count({
    where: { whiteLabelId: wl.id, deleted: false },
  });

  console.log(`Marca:              ${wl.name} (${slug})`);
  console.log(`Negocios:           ${negocios}`);
  console.log(`Con correo o tel.:  ${contactables}`);
  console.log(`Contactos actuales: ${yaHay}`);

  if (!APLICAR) {
    console.log('\n[simulación] no se escribió nada. Repite con --aplicar.');
    await prisma.$disconnect();
    return;
  }

  const svc = new MktContactService(prisma);
  const r = await svc.syncTenants(wl.id);
  console.log(
    `\n✓ creados=${r.created}  actualizados=${r.updated}  omitidos=${r.skipped}  total ahora=${r.contacts}`,
  );
  if (r.skipped) {
    console.log('  (omitidos = negocios sin correo NI teléfono: no hay a quién escribir)');
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
