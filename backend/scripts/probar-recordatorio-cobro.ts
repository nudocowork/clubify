/**
 * Manda UN recordatorio de cobro real, por el mismo camino que el cron.
 *
 * No replica la lógica: instancia `BrandEmailService` de verdad, así que pasa
 * por la resolución de marca, la herencia de plantilla (marca > global >
 * default), la interpolación de tokens, el HTML de marca y el envío por la
 * subcuenta de Grow Business. Si esto sale bien, el cron también.
 *
 * Uso:
 *   railway run npx ts-node scripts/probar-recordatorio-cobro.ts <slugMarca> <correo> [plantilla]
 *
 * Ejemplo:
 *   railway run npx ts-node scripts/probar-recordatorio-cobro.ts sellea alguien@correo.com
 *
 * Manda un correo REAL. No escribe nada en la base.
 */
import { PrismaService } from '../src/common/prisma/prisma.service';
import { GrowBusinessService } from '../src/integrations/grow-business.service';
import { BrandEmailService } from '../src/email/brand-email.service';
import { fmtEmailDate } from '../src/email/brand-email-templates';

const [slug, destino, plantillaArg] = process.argv.slice(2);
const PLANTILLA = plantillaArg || 'email_payment_reminder_3d';

async function main() {
  if (!slug || !destino) {
    console.error(
      'Uso: probar-recordatorio-cobro.ts <slugMarca> <correo> [plantilla]',
    );
    process.exit(1);
  }

  const prisma = new PrismaService();
  await prisma.$connect();
  const grow = new GrowBusinessService(prisma);
  const svc = new BrandEmailService(prisma, grow);

  const wl = await prisma.whiteLabel.findFirst({
    where: { slug },
    select: {
      id: true,
      name: true,
      domain: true,
      contactEmail: true,
      growBusinessLocationId: true,
    },
  });
  if (!wl) {
    console.error(`No existe la marca "${slug}".`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // Un negocio REAL de la marca: así el correo lleva su nombre, su logo, su
  // color y su fecha de cobro, igual que le llegaría al cliente.
  const tenant = await prisma.tenant.findFirst({
    where: {
      whiteLabelId: wl.id,
      deletedAt: null,
      currentPeriodEnd: { not: null },
    },
    select: { id: true, brandName: true, currentPeriodEnd: true },
    orderBy: { currentPeriodEnd: 'asc' },
  });
  if (!tenant) {
    console.error(`La marca ${wl.name} no tiene negocios con cobro programado.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`Marca:     ${wl.name} (${slug})`);
  console.log(`Subcuenta: ${wl.growBusinessLocationId ?? '— sin subcuenta —'}`);
  console.log(`Negocio:   ${tenant.brandName}`);
  console.log(`Cobro:     ${fmtEmailDate(tenant.currentPeriodEnd!)}`);
  console.log(`Plantilla: ${PLANTILLA}`);
  console.log(`Destino:   ${destino}\n`);

  // Mismas variables que le pasa el cron en la ventana D-3.
  const r = await svc.sendTemplate({
    templateId: PLANTILLA,
    tenantId: tenant.id,
    to: destino,
    vars: { chargeDate: fmtEmailDate(tenant.currentPeriodEnd!) },
  });

  if (r.sent) {
    console.log('✓ Enviado. Revisa la bandeja (y la carpeta de spam).');
  } else {
    console.log(`✗ No se envió. Motivo: ${r.reason}`);
    const motivos: Record<string, string> = {
      no_connection: 'la marca no tiene subcuenta de Grow Business conectada',
      template_disabled: 'la plantilla está apagada para esta marca',
      unknown_template: 'ese id de plantilla no existe en el catálogo',
      no_recipient: 'no hay correo de destino',
      tenant_not_found: 'no se encontró el negocio',
      send_failed: 'Grow Business rechazó el envío (ver logs arriba)',
    };
    if (motivos[r.reason]) console.log(`  → ${motivos[r.reason]}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
