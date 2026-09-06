/**
 * SOLO LECTURA: por qué canal avisan hoy los negocios a sus clientes.
 *
 * Un cliente recibió mensajes de fidelización desde un número que no conoce.
 * Antes de quitarle el SMS a nadie hay que saber cuántas reglas lo usan, de
 * cuántos negocios, y —lo que de verdad decide— cuántos clientes tienen la
 * tarjeta instalada: el push SOLO llega a esos. A los demás, hoy les llega el
 * SMS y mañana no les llegaría nada.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const reglas = await p.automationRule.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        trigger: true,
        actions: true,
        tenant: { select: { name: true } },
      },
    });

    const porCanal = new Map();
    const negociosConSms = new Set();
    const ejemplos = [];
    for (const r of reglas) {
      const acciones = Array.isArray(r.actions) ? r.actions : [];
      for (const a of acciones) {
        const t = a?.type ?? '?';
        const k = `${t}${r.isActive ? '' : ' (apagada)'}`;
        porCanal.set(k, (porCanal.get(k) || 0) + 1);
        if (
          r.isActive &&
          (t === 'SEND_SMS' || t === 'SEND_WHATSAPP' || t === 'SEND_WHATSAPP_LINK')
        ) {
          negociosConSms.add(r.tenant?.name ?? '?');
          if (ejemplos.length < 8) {
            ejemplos.push(
              `${r.tenant?.name} · ${r.name} · ${(r.trigger || {}).type ?? '?'} · ${t}`,
            );
          }
        }
      }
    }

    console.log(`reglas de automatización: ${reglas.length}`);
    for (const [k, n] of [...porCanal.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${k}`);
    }
    console.log(`\nnegocios que mandan por SMS/WhatsApp: ${negociosConSms.size}`);
    for (const e of ejemplos) console.log(`  · ${e}`);

    // Lo que decide de verdad: a cuántos llega el push.
    const pases = await p.pass.count();
    const instalados = await p.pass.count({
      where: { walletInstalledAt: { not: null } },
    });
    const pct = pases ? Math.round((instalados / pases) * 100) : 0;
    console.log(
      `\ntarjetas: ${pases} · instaladas en la billetera: ${instalados} (${pct}%)`,
    );
    console.log(
      `  a ${pases - instalados} clientes el push NO les llega: no la instalaron`,
    );
  } finally {
    await p.$disconnect();
  }
})();
