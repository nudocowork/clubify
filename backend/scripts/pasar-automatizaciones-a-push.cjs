/**
 * Pasa a PUSH las acciones de automatización que hoy salen por SMS o WhatsApp.
 *
 * Por qué: al cliente le llega un mensaje de fidelización desde un número que
 * no conoce —el de la subcuenta de Grow Business—, y se lee como spam. La
 * notificación de la tarjeta llega con la marca del negocio, no cuesta saldo y
 * no expone ningún número.
 *
 * El 97% de las tarjetas están instaladas, así que el push llega a casi todos.
 * A quien no la instaló ya no le llegará: es la contrapartida, y está decidida.
 *
 * SEND_PUSH necesita título, y SMS/WhatsApp solo traen cuerpo. El título sale
 * del NOMBRE DE LA REGLA, que es lo que el propio negocio escribió para
 * describirla («Saludo de cumpleaños»), y el cuerpo se conserva palabra por
 * palabra: el texto es suyo, no nuestro.
 *
 *   railway run node scripts/pasar-automatizaciones-a-push.cjs           (simula)
 *   railway run node scripts/pasar-automatizaciones-a-push.cjs --aplicar (escribe)
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const POR_MENSAJE = ['SEND_SMS', 'SEND_WHATSAPP', 'SEND_WHATSAPP_LINK'];

(async () => {
  const p = new PrismaClient();
  try {
    const reglas = await p.automationRule.findMany({
      select: {
        id: true,
        name: true,
        actions: true,
        isActive: true,
        tenant: { select: { name: true } },
      },
    });

    let cambiadas = 0;
    for (const r of reglas) {
      const acciones = Array.isArray(r.actions) ? r.actions : [];
      if (!acciones.some((a) => POR_MENSAJE.includes(a?.type))) continue;

      const nuevas = acciones.map((a) => {
        if (!POR_MENSAJE.includes(a?.type)) return a;
        return {
          type: 'SEND_PUSH',
          // El título es el nombre de la regla: lo escribió el negocio para
          // describir ESE aviso, así que describe bien lo que el cliente va a
          // recibir. Inventar uno seria ponerle palabras en la boca.
          title: r.name,
          body: a.body ?? '',
        };
      });

      console.log(
        `${r.tenant?.name} · ${r.name}${r.isActive ? '' : ' (apagada)'}`,
      );
      for (const a of acciones.filter((x) => POR_MENSAJE.includes(x?.type))) {
        console.log(`    ${a.type} → SEND_PUSH`);
        console.log(`      «${(a.body ?? '').slice(0, 70)}»`);
      }

      // Sugar & Kiss tenia el MISMO texto por WhatsApp y por SMS —cinturon y
      // tirantes para llegar seguro—. Convertidos los dos a push, al cliente le
      // llegarian dos notificaciones identicas seguidas. Se queda una.
      const vistos = new Set();
      const finales = nuevas.filter((a) => {
        if (a?.type !== 'SEND_PUSH') return true;
        const clave = `${a.title}|${a.body}`;
        if (vistos.has(clave)) {
          console.log('    (se quita un push duplicado con el mismo texto)');
          return false;
        }
        vistos.add(clave);
        return true;
      });

      if (APLICAR) {
        await p.automationRule.update({
          where: { id: r.id },
          data: { actions: finales },
        });
      }
      cambiadas++;
    }

    console.log(
      `\n${cambiadas} regla(s) ${APLICAR ? 'convertidas' : 'a convertir (simulación)'}`,
    );
    if (!APLICAR) console.log('Para aplicarlo de verdad: añade --aplicar');
  } finally {
    await p.$disconnect();
  }
})();
