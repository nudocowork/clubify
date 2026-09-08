/**
 * La lista de números a los que el sistema NO escribe.
 *
 * Se comprueba dentro de `GrowBusinessService`, por donde pasa TODO lo que sale
 * de la plataforma, así que ninguna vía nueva puede saltársela por olvido.
 *
 *   railway run node scripts/no-molestar.cjs                 (ver la lista)
 *   railway run node scripts/no-molestar.cjs add "+57300..."  (añadir)
 *   railway run node scripts/no-molestar.cjs quitar "+57300..."
 *
 * Ojo: esto silencia TODOS los mensajes a ese número, incluidos los que sí
 * querría recibir. Antes de usarlo, mirar si el aviso concreto se puede
 * arreglar en su origen — casi siempre se puede, y es mejor.
 */
const { PrismaClient } = require('@prisma/client');

const CLAVE = 'mensajes.numerosBloqueados';
const [accion, numero] = process.argv.slice(2);

(async () => {
  const p = new PrismaClient();
  try {
    const s = await p.setting.findUnique({ where: { key: CLAVE } });
    let lista = [];
    try {
      lista = JSON.parse(s?.value ?? '[]');
    } catch {
      lista = [];
    }

    if (accion === 'add' && numero) {
      if (!lista.includes(numero)) lista.push(numero);
    } else if ((accion === 'quitar' || accion === 'rm') && numero) {
      const cola = numero.replace(/\D/g, '').slice(-10);
      lista = lista.filter((n) => String(n).replace(/\D/g, '').slice(-10) !== cola);
    } else if (accion) {
      console.log('uso: no-molestar.cjs [add|quitar] "<numero>"');
      return;
    }

    if (accion) {
      await p.setting.upsert({
        where: { key: CLAVE },
        create: { key: CLAVE, value: JSON.stringify(lista) },
        update: { value: JSON.stringify(lista) },
      });
    }

    console.log(`números en la lista de no molestar: ${lista.length}`);
    for (const n of lista) console.log(`  ${n}`);
  } finally {
    await p.$disconnect();
  }
})();
