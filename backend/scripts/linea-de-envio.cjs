/**
 * Por qué línea de Grow Business sale cada mensaje.
 *
 * Grow Business enruta por un prefijo `#switch_unique|N|` que se antepone a
 * cada mensaje. La N sale de la primera de estas que esté puesta:
 *
 *   1. `Tenant.growBusinessSwitchNumber`     — la del negocio
 *   2. `WhiteLabel.growBusinessSwitchNumber` — la de la marca
 *   3. `GrowBusinessAccount.switchNumber`    — la cuenta de plataforma
 *   4. `DEFAULT_SUPPORT_SWITCH` en el código — hoy 1
 *
 * OJO (2026-08-01): el default del código se cambió de 2 a 1 porque el
 * WhatsApp del 2 fallaba en la entrega. Si vuelves a mover algo al 2,
 * comprueba que los mensajes llegan de verdad antes de darlo por bueno.
 *
 *   Ver:     railway run node scripts/linea-de-envio.cjs
 *   Cambiar: railway run node scripts/linea-de-envio.cjs plataforma 2
 *            railway run node scripts/linea-de-envio.cjs marca Clubify 2
 *
 * NO toca los negocios uno a uno: eso se hace desde su propia ficha.
 * Idempotente.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function ver() {
  const accs = await p.growBusinessAccount.findMany({
    where: { deletedAt: null },
    select: { name: true, purpose: true, switchNumber: true },
  });
  console.log('CUENTAS DE PLATAFORMA (avisos al equipo, activaciones):');
  for (const a of accs) {
    console.log(
      `  ${a.name.padEnd(14)} línea ${a.switchNumber ?? '— (hereda la 1 del código)'}`,
    );
  }
  const wls = await p.whiteLabel.findMany({
    select: {
      name: true,
      growBusinessLocationId: true,
      growBusinessSwitchNumber: true,
    },
  });
  console.log('\nMARCAS (cobros de sus negocios):');
  for (const w of wls) {
    console.log(
      `  ${String(w.name).padEnd(14)} ${w.growBusinessLocationId ? 'con subcuenta' : 'SIN subcuenta'} · línea ${w.growBusinessSwitchNumber ?? '— (hereda)'}`,
    );
  }
  const ts = await p.tenant.findMany({
    where: { growBusinessSwitchNumber: { not: null } },
    select: { brandName: true, growBusinessSwitchNumber: true },
  });
  console.log('\nNEGOCIOS con línea propia (mandan sobre la marca):');
  console.log(
    ts.length
      ? ts.map((t) => `  ${t.brandName} → línea ${t.growBusinessSwitchNumber}`).join('\n')
      : '  ninguno',
  );
}

(async () => {
  const [accion, a, b] = process.argv.slice(2);

  if (!accion || accion === 'ver') {
    await ver();
    return p.$disconnect();
  }

  const linea = Number(accion === 'plataforma' ? a : b);
  if (!Number.isInteger(linea) || linea < 1 || linea > 10) {
    throw new Error('la línea tiene que ser un entero entre 1 y 10');
  }

  if (accion === 'plataforma') {
    const r = await p.growBusinessAccount.updateMany({
      where: { deletedAt: null },
      data: { switchNumber: linea },
    });
    console.log(`cuentas de plataforma actualizadas: ${r.count} → línea ${linea}\n`);
  } else if (accion === 'marca') {
    if (!a) throw new Error('uso: marca <nombre> <linea>');
    const wl = await p.whiteLabel.findFirst({ where: { name: a } });
    if (!wl) throw new Error(`no existe la marca "${a}"`);
    await p.whiteLabel.update({
      where: { id: wl.id },
      data: { growBusinessSwitchNumber: linea },
    });
    console.log(`marca ${wl.name} → línea ${linea}\n`);
  } else {
    throw new Error(`acción desconocida "${accion}". Usa: ver | plataforma | marca`);
  }

  await ver();
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
