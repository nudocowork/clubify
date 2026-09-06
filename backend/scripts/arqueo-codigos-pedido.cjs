/**
 * SOLO LECTURA: cuánto de adivinable es un código de pedido.
 *
 * El código son 4 caracteres de un alfabeto de 30 → 810.000 combinaciones, y es
 * ÚNICO EN TODA LA PLATAFORMA. La ruta pública `/api/public/orders/:code`
 * devuelve nombre, teléfono y dirección de entrega del cliente.
 *
 * Este script mide la probabilidad real de acertar a ciegas. Sin esto, la
 * discusión se queda en «es improbable» sin número que lo respalde.
 */
const { PrismaClient } = require('@prisma/client');

const ALFABETO = 30;
const LARGO = 4;

(async () => {
  const p = new PrismaClient();
  try {
    const total = await p.order.count();
    const espacio = Math.pow(ALFABETO, LARGO);
    const prob = total / espacio;
    console.log(`pedidos en la plataforma: ${total.toLocaleString('es-CO')}`);
    console.log(`combinaciones posibles:   ${espacio.toLocaleString('es-CO')}`);
    console.log(`probabilidad por intento: 1 de ${Math.round(1 / prob)}`);
    // El límite global es de 100 peticiones por minuto.
    const porDia = 100 * 60 * 24;
    console.log(
      `a 100 peticiones/min: ${Math.round(porDia * prob).toLocaleString('es-CO')} ` +
        'fichas de cliente al día, desde una sola IP',
    );
  } finally {
    await p.$disconnect();
  }
})();
