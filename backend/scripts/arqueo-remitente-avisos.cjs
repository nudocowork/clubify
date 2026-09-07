/**
 * SOLO LECTURA: desde qué subcuenta salen los avisos internos del equipo.
 *
 * Un aviso del sistema que llega desde el móvil de una persona confunde a quien
 * lo recibe —«¿por qué me escribe Sara?»— y, peor, si esa persona sale del
 * equipo el canal se cae sin que nadie lo note.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const elegida = await p.setting.findUnique({
      where: { key: 'prereg.alertAccountId' },
    });
    console.log(
      `Setting prereg.alertAccountId: ${elegida?.value ?? 'SIN CONFIGURAR (cae a la primera GENERAL)'}`,
    );

    const cuentas = await p.growBusinessAccount.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        purpose: true,
        locationId: true,
        switchNumber: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`\nsubcuentas de Grow Business: ${cuentas.length}`);
    for (const c of cuentas) {
      const usada =
        elegida?.value === c.id ||
        (!elegida?.value && c.purpose === 'GENERAL');
      console.log(
        `  ${usada ? '→ ' : '  '}${c.name} · ${c.purpose} · switch ${c.switchNumber ?? '-'} · ${c.id}`,
      );
    }
    console.log(
      '\nEl «switch» es el numero desde el que sale el SMS dentro de esa' +
        ' subcuenta:\nsi ahi esta el movil de una persona, el aviso llega con su nombre.',
    );
  } finally {
    await p.$disconnect();
  }
})();
