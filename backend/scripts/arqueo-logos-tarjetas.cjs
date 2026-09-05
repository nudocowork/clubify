/**
 * SOLO LECTURA: qué forma de logo y qué chip tienen las tarjetas.
 *
 * Decide si aplicar la forma al pase de verdad puede encoger logos a negocios
 * que nunca eligieron nada: el editor guarda 'ROUNDED' por defecto aunque el
 * dueño no toque el selector.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const cards = await p.card.findMany({
      select: { logoShape: true, logoBgColor: true, isActive: true },
    });
    const porForma = new Map();
    let conChip = 0;
    let conChipYForma = 0;
    for (const c of cards) {
      const k = c.logoShape ?? '(sin definir)';
      porForma.set(k, (porForma.get(k) || 0) + 1);
      if (c.logoBgColor) {
        conChip++;
        if (c.logoShape && c.logoShape !== 'RECTANGLE') conChipYForma++;
      }
    }
    console.log(`tarjetas: ${cards.length}`);
    for (const [k, n] of [...porForma.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${k}`);
    }
    console.log(`con chip de color: ${conChip}`);
    console.log(`con chip Y forma distinta de rectángulo: ${conChipYForma}`);
  } finally {
    await p.$disconnect();
  }
})();
