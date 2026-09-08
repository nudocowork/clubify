/**
 * SOLO LECTURA: dos formas de contar «pases instalados» que no dan lo mismo.
 *
 * El panel cuenta los pases que tienen un DISPOSITIVO registrado
 * (`walletDevices`), y eso solo lo crea Apple al darse de alta para recibir
 * push. Un cliente de Android que instaló su tarjeta en Google Wallet no
 * aparece por ningún lado.
 *
 * `walletInstalledAt` en cambio se sella para las DOS plataformas, en el
 * momento en que el cliente se descarga la tarjeta.
 *
 * Si los dos números se separan mucho, el negocio está viendo un porcentaje de
 * instalación falso y creyendo que sus clientes no instalan la tarjeta.
 */
const { PrismaClient } = require('@prisma/client');

const NOMBRE = process.argv[2];

(async () => {
  const p = new PrismaClient();
  try {
    const donde = NOMBRE
      ? { tenant: { name: { contains: NOMBRE, mode: 'insensitive' } } }
      : {};
    const [total, conDispositivo, conSello, apple, google, sinPlataforma] =
      await Promise.all([
        p.pass.count({ where: donde }),
        p.pass.count({ where: { ...donde, walletDevices: { some: {} } } }),
        p.pass.count({ where: { ...donde, walletInstalledAt: { not: null } } }),
        p.pass.count({ where: { ...donde, walletPlatform: 'APPLE' } }),
        p.pass.count({ where: { ...donde, walletPlatform: 'GOOGLE' } }),
        p.pass.count({ where: { ...donde, walletPlatform: null } }),
      ]);

    console.log(NOMBRE ? `Negocio: ${NOMBRE}` : 'TODA LA PLATAFORMA');
    console.log(`  pases emitidos:                    ${total}`);
    console.log(`  como los cuenta el panel HOY:      ${conDispositivo}  (dispositivo Apple registrado)`);
    console.log(`  instalados de verdad:              ${conSello}  (se descargaron la tarjeta)`);
    console.log(`     · en Apple:  ${apple}`);
    console.log(`     · en Google: ${google}`);
    console.log(`     · sin instalar todavia: ${sinPlataforma}`);
    if (total) {
      const hoy = Math.round((conDispositivo / total) * 100);
      const real = Math.round((conSello / total) * 100);
      console.log(`\n  el panel dice ${hoy}% · la realidad es ${real}%`);
    }
  } finally {
    await p.$disconnect();
  }
})();
