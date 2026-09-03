/**
 * Devuelve un negocio a la conexión ESTÁNDAR de su marca.
 *
 * Hay negocios que tienen copiadas en su ficha las credenciales de Grow
 * Business de Clubify, como si fueran suyas. No lo son: es la misma subcuenta
 * de la marca, duplicada a mano. Mientras esté ahí:
 *
 *   - parece que el negocio tiene conexión propia y no la tiene;
 *   - su `switchNumber` pisa al de la marca, así que cambiar la línea de la
 *     marca no les afecta y nadie entiende por qué.
 *
 * Quitarla NO cambia por dónde salen sus mensajes: al no tener credenciales
 * propias, la cascada cae a las de su marca — que son literalmente las mismas.
 * Por eso el script COMPRUEBA que la conexión sea la de la marca antes de
 * borrarla, y se niega si el negocio tiene una subcuenta de verdad.
 *
 *   Ver:     railway run node scripts/quitar-conexion-prestada.cjs
 *   Aplicar: railway run node scripts/quitar-conexion-prestada.cjs MOTILART "Wok Explosivo"
 *
 * Idempotente.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const nombres = process.argv.slice(2);

  const wls = await p.whiteLabel.findMany({
    select: { id: true, name: true, growBusinessLocationId: true },
  });
  const locDeMarca = new Map(
    wls.filter((w) => w.growBusinessLocationId).map((w) => [w.id, w.growBusinessLocationId]),
  );

  if (nombres.length === 0) {
    const ts = await p.tenant.findMany({
      where: {
        OR: [
          { growBusinessLocationId: { not: null } },
          { growBusinessSwitchNumber: { not: null } },
        ],
      },
      select: {
        brandName: true,
        growBusinessLocationId: true,
        growBusinessSwitchNumber: true,
        whiteLabelId: true,
        whiteLabel: { select: { name: true } },
      },
    });
    console.log('negocios con conexión o línea propia:\n');
    for (const t of ts) {
      const loc = t.growBusinessLocationId;
      const suya = locDeMarca.get(t.whiteLabelId ?? '');
      const estado = !loc
        ? 'sin conexión — la línea propia no hace nada'
        : loc === suya
          ? `PRESTADA de ${t.whiteLabel?.name}`
          : 'subcuenta propia de verdad';
      console.log(
        `  ${t.brandName.padEnd(16)} línea=${String(t.growBusinessSwitchNumber ?? '—').padEnd(3)} ${estado}`,
      );
    }
    return p.$disconnect();
  }

  for (const nombre of nombres) {
    const t = await p.tenant.findFirst({
      where: { brandName: nombre },
      select: {
        id: true,
        brandName: true,
        growBusinessLocationId: true,
        growBusinessSwitchNumber: true,
        whiteLabelId: true,
        whiteLabel: { select: { name: true, growBusinessSwitchNumber: true } },
      },
    });
    if (!t) {
      console.log(`✗ ${nombre}: no existe`);
      continue;
    }
    const suya = locDeMarca.get(t.whiteLabelId ?? '');
    if (t.growBusinessLocationId && t.growBusinessLocationId !== suya) {
      // Guard: si la conexión NO es la de su marca, es propia de verdad y
      // borrarla dejaría al negocio sin poder enviar.
      console.log(
        `✗ ${t.brandName}: tiene subcuenta PROPIA (${t.growBusinessLocationId}) — no se toca`,
      );
      continue;
    }
    await p.tenant.update({
      where: { id: t.id },
      data: {
        growBusinessLocationId: null,
        growBusinessApiKey: null,
        growBusinessConnectedAt: null,
        growBusinessSwitchNumber: null,
      },
    });
    console.log(
      `✓ ${t.brandName}: estándar. Ahora hereda de ${t.whiteLabel?.name} (línea ${t.whiteLabel?.growBusinessSwitchNumber ?? '— por defecto'})`,
    );
  }
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
