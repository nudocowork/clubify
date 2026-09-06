/** SOLO LECTURA: estado del aviso de venta a los afiliados. */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const s = await p.setting.findUnique({
      where: { key: 'afiliados.avisoVentas.desde' },
    });
    console.log(
      'arranque guardado:',
      s ? s.value : 'todavía no — el cron corre cada 5 minutos',
    );
    console.log('avisos enviados:', await p.affiliateSaleAlert.count());
    const total = await p.referralCode.count();
    const conTelefono = await p.referralCode.count({
      where: { ownerWhatsapp: { not: '' } },
    });
    console.log(`afiliados: ${total} · con WhatsApp cargado: ${conTelefono}`);
    // A los que no tienen teléfono no se les puede avisar. Conviene saberlo
    // antes de que uno pregunte por qué no le llega nada.
    if (conTelefono < total) {
      console.log(`  ${total - conTelefono} SIN teléfono: a esos no les llega`);
    }
  } finally {
    await p.$disconnect();
  }
})();
