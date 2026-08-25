/** SOLO LECTURA: por qué subcuenta y qué número sale el SMS de un negocio.
 *  Replica la cascada de `BillingService.resolveBillingTarget`.
 *  Uso: node scripts/diag-remitente-sms.cjs "<parte del nombre>" */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const q = process.argv[2] || 'MOTILART';

(async () => {
  const negocios = await p.tenant.findMany({
    where: { brandName: { contains: q, mode: 'insensitive' }, deletedAt: null },
    select: {
      id: true, brandName: true,
      billingAlertsEnabled: true, billingAlertsPhone: true,
      billingAlertsAccountId: true,
      growBusinessLocationId: true, growBusinessSwitchNumber: true,
      whiteLabel: {
        select: {
          name: true, slug: true,
          growBusinessLocationId: true, growBusinessSwitchNumber: true,
        },
      },
    },
    take: 5,
  });

  for (const t of negocios) {
    console.log(`\n=== ${t.brandName} (marca: ${t.whiteLabel?.name ?? 'sin marca'}) ===`);
    let origen = null;
    let loc = null;
    let sw = null;

    if (t.billingAlertsAccountId) {
      const acc = await p.growBusinessAccount.findFirst({
        where: { id: t.billingAlertsAccountId, deletedAt: null },
        select: { name: true, locationId: true, switchNumber: true, purpose: true },
      });
      if (acc) {
        origen = `subcuenta GLOBAL asignada · "${acc.name}" (${acc.purpose})`;
        loc = acc.locationId; sw = acc.switchNumber;
      }
    }
    if (!origen && t.growBusinessLocationId) {
      origen = 'credenciales PROPIAS del negocio';
      loc = t.growBusinessLocationId; sw = t.growBusinessSwitchNumber;
    }
    if (!origen && t.whiteLabel?.growBusinessLocationId) {
      origen = `subcuenta de la MARCA (${t.whiteLabel.name})`;
      loc = t.whiteLabel.growBusinessLocationId; sw = t.whiteLabel.growBusinessSwitchNumber;
    }

    console.log(`  sale por      : ${origen ?? 'NADA — no se envía SMS'}`);
    if (loc) console.log(`  locationId    : ${loc}`);
    console.log(`  switch number : ${sw ?? '1 (por defecto = ventas)'}`);
    console.log(`  destinatario  : ${t.billingAlertsPhone || '(cascada: teléfono del dueño)'}`);
    console.log(`  avisos activos: ${t.billingAlertsEnabled ? 'sí' : 'NO'}`);
  }

  console.log(
    '\nNota: el NÚMERO real de salida vive en la subcuenta de Grow Business.' +
    '\nAcá guardamos el locationId y la prioridad (`#switch_unique|N|`), no el número.',
  );
  await p.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await p.$disconnect(); process.exitCode = 1; });
