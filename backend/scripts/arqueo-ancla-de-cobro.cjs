/**
 * SOLO LECTURA: ¿el día de cobro se mueve cuando alguien paga tarde?
 *
 * La pregunta: si un negocio entra el 1 de agosto, le toca el 1 de septiembre
 * y paga el 8, ¿su próximo cobro sigue siendo el 1 de octubre, o se le corre
 * al 8?
 *
 * Para Hotmart la fecha NO la calculamos: viene en el webhook
 * (`date_next_charge`) y se guarda tal cual (`hotmart.service.ts`). Así que
 * esto comprueba qué está haciendo Hotmart de verdad, con los pagos reales.
 *
 * Compara, para cada negocio que pagó en los últimos 60 días: el DÍA DEL MES
 * del pago contra el día del mes del próximo cobro. Si coinciden, el ancla se
 * movió al pago. Si no, se conservó.
 */
const { PrismaClient } = require('@prisma/client');

const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const dia = (d) => (d ? new Date(d).getUTCDate() : null);

(async () => {
  const p = new PrismaClient();
  try {
    const desde = new Date(Date.now() - 60 * 86400000);
    const ts = await p.tenant.findMany({
      where: { lastChargeAt: { gte: desde }, currentPeriodEnd: { not: null } },
      select: {
        brandName: true,
        lastChargeAt: true,
        currentPeriodEnd: true,
        planPeriodicity: true,
        firstFailedAt: true,
      },
      orderBy: { lastChargeAt: 'desc' },
    });

    console.log(`negocios que pagaron en 60 días: ${ts.length}\n`);
    console.log('  negocio                        pagó        próximo     día pago / día cobro');

    let conservan = 0;
    let mueven = 0;
    for (const t of ts) {
      const dp = dia(t.lastChargeAt);
      const dc = dia(t.currentPeriodEnd);
      const igual = dp === dc;
      if (igual) mueven++;
      else conservan++;
      console.log(
        `  ${(t.brandName ?? '').slice(0, 28).padEnd(30)} ` +
          `${f(t.lastChargeAt)}  ${f(t.currentPeriodEnd)}   ` +
          `${String(dp).padStart(2)} / ${String(dc).padStart(2)}  ` +
          `${igual ? '← se movió al día del pago' : 'ancla conservada'}`,
      );
    }

    console.log(`\n  ancla conservada: ${conservan}`);
    console.log(`  movida al pago:   ${mueven}`);
    console.log(
      '\n  Ojo: coincidir de día no prueba que se haya movido — quien paga\n' +
        '  puntual el día que le toca da el mismo número. Lo que importa son\n' +
        '  los que pagaron TARDE; se ven abajo.',
    );

    // Los que pagaron tarde de verdad: tuvieron un fallo antes del pago.
    const tarde = ts.filter((t) => t.firstFailedAt);
    console.log(`\nlos que venían de un cobro fallido (${tarde.length}):`);
    for (const t of tarde) {
      console.log(
        `  ${(t.brandName ?? '').slice(0, 28).padEnd(30)} falló ${f(t.firstFailedAt)} · ` +
          `pagó ${f(t.lastChargeAt)} · próximo ${f(t.currentPeriodEnd)}`,
      );
    }
  } finally {
    await p.$disconnect();
  }
})();
