/**
 * SOLO LECTURA: a cuántos negocios les llegaría de verdad el aviso de pedido.
 *
 * Encenderlo para todos no sirve de nada si el negocio no tiene por dónde
 * enviar. Este script separa las dos cosas que hacen falta —un TELÉFONO al que
 * mandarlo y unas CREDENCIALES con las que mandarlo— para saber cuántos quedan
 * fuera y por qué, antes de prometerle a nadie que le va a llegar.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const tenants = await p.tenant.findMany({
      where: { status: { not: 'SUSPENDED' } },
      select: {
        id: true,
        name: true,
        whatsappOrdersPhone: true,
        whatsappPhone: true,
        phone: true,
        growBusinessLocationId: true,
        growBusinessApiKey: true,
        whiteLabel: {
          select: { growBusinessLocationId: true, growBusinessApiKey: true },
        },
      },
    });

    // El teléfono del dueño, para los que no tengan ninguno propio.
    const owners = await p.user.findMany({
      where: { role: 'TENANT_OWNER', isActive: true, phone: { not: null } },
      select: { tenantId: true, phone: true },
    });
    const telDueno = new Map(owners.map((o) => [o.tenantId, o.phone]));

    let conTelefono = 0;
    let soloPorDueno = 0;
    let conCreds = 0;
    let listos = 0;
    const sinNada = [];

    for (const t of tenants) {
      const propio =
        t.whatsappOrdersPhone?.trim() ||
        t.whatsappPhone?.trim() ||
        t.phone?.trim() ||
        null;
      const dueno = telDueno.get(t.id)?.trim() || null;
      const tel = propio || dueno;
      if (tel) conTelefono++;
      if (!propio && dueno) soloPorDueno++;

      const creds =
        (t.growBusinessLocationId && t.growBusinessApiKey) ||
        (t.whiteLabel?.growBusinessLocationId && t.whiteLabel?.growBusinessApiKey);
      if (creds) conCreds++;
      if (tel && creds) listos++;
      if (!tel) sinNada.push(t.name);
    }

    console.log(`negocios activos: ${tenants.length}`);
    console.log(`  con teléfono al que avisar: ${conTelefono}`);
    console.log(`    de esos, SOLO por el del dueño: ${soloPorDueno}`);
    console.log(`  con credenciales para enviar: ${conCreds}`);
    console.log(`  LES LLEGARÍA DE VERDAD: ${listos}`);
    console.log(`  sin ningún teléfono: ${sinNada.length}`);
    if (sinNada.length) console.log(`    ${sinNada.slice(0, 10).join(', ')}`);
  } finally {
    await p.$disconnect();
  }
})();
