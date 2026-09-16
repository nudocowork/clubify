import { describe, it, expect } from 'vitest';
import { NotificationsService } from './notifications.service';

/**
 * Un envío PROGRAMADO sale una vez. Una. No dos ni tres.
 *
 * EL FALLO (reportado por varios negocios a Javier, 16-09-2026): «cuando se
 * deja programado las notificaciones push en horas concretas, hasta 2 o 3
 * veces se repite el envío en lapso de minutos».
 *
 * La causa era leer-decidir-escribir sin atomicidad en `dispatchScheduled`:
 *
 *     const due = await findMany({ sentAt: null, ... });          // (1) lee
 *     await update({ where: { id: n.id }, data: { sentAt } });    // (2) escribe
 *     await this.despachar(n);                                    // (3) envía
 *
 * El `update` por id no comprueba que la fila siguiera pendiente, así que no
 * hay forma de saber si otro se adelantó. Y adelantarse no exige dos
 * servidores: el cron corre cada 5 minutos, se lleva 50 filas y las despacha
 * EN SERIE esperando el push de cada pase. Con cientos de pases el tick de las
 * 10:05 arranca con el de las 10:00 a medias, ve como pendientes las filas que
 * el primero aún no tocó, y las envía; luego el primero llega a ellas y las
 * envía otra vez. Copias separadas por minutos: justo lo que se reportó.
 *
 * Aquí se simulan DOS CORRIDAS SIMULTÁNEAS sobre la misma fila pendiente.
 *
 * El `updateMany` del doble es atómico a propósito (no tiene ningún `await`
 * dentro), que es lo que hace Postgres con un UPDATE sobre una fila: de dos
 * corridas, una se lleva count=1 y la otra count=0.
 */

const cede = () => new Promise((r) => setTimeout(r, 0));

function entorno(sentAtInicial: Date | null = null) {
  const fila: any = {
    id: 'n1',
    tenantId: 't1',
    cardId: null,
    customerId: null,
    title: 'Promo de la tarde',
    body: '2x1 hasta las 6',
    triggerType: 'SCHEDULED',
    scheduledAt: new Date(Date.now() - 60_000), // venció hace un minuto
    sentAt: sentAtInicial,
  };

  /** Cada push que sale de verdad. Es lo que le llega al cliente. */
  const pushes: string[] = [];
  let vecesQueSeLeyoLaLista = 0;

  const prisma: any = {
    notification: {
      findMany: async () => {
        vecesQueSeLeyoLaLista += 1;
        // La foto se saca ANTES de ceder, que es lo que hace un SELECT: se
        // lleva las filas que estaban pendientes en ESE momento. Es el hueco
        // real del bug — el tick de las 10:00 sigue despachando pases cuando
        // el de las 10:05 lanza su consulta, así que los dos se llevan la
        // misma fila todavía sin enviar.
        //
        // OJO si se toca esto: si el `await` se pone ANTES de la foto, la
        // segunda corrida lee cuando la primera ya escribió, la carrera
        // desaparece y el test pasa aunque el claim atómico esté roto. Pasó
        // al escribirlo: daba verde con el arreglo quitado.
        const foto = fila.sentAt === null ? [{ ...fila }] : [];
        await cede();
        return foto;
      },
      // ATÓMICO: sin `await` dentro, como el UPDATE de una fila en Postgres.
      updateMany: async ({ where, data }: any) => {
        if (where.id !== fila.id) return { count: 0 };
        if (where.sentAt === null && fila.sentAt !== null) return { count: 0 };
        Object.assign(fila, data);
        return { count: 1 };
      },
      update: async ({ data }: any) => {
        Object.assign(fila, data);
        return { ...fila };
      },
    },
    pass: {
      findMany: async () => [
        { id: 'p1', googleObjectId: 'g1', walletDevices: [{ id: 'd1' }] },
      ],
      updateMany: async () => ({ count: 1 }),
    },
  };

  const wallet: any = {
    pushPassUpdate: async (passId: string) => {
      pushes.push(passId);
      await cede(); // el push tarda; es durante esta espera que entra el otro tick
      return { sent: 1, google: { ok: true } };
    },
  };

  const svc = new NotificationsService(prisma, wallet);
  return {
    svc,
    pushes,
    fila,
    lecturas: () => vecesQueSeLeyoLaLista,
    /** Una pasada del cron, sin el cerrojo en memoria: simula OTRO proceso. */
    corrida: () => (svc as any).recorrerProgramadasVencidas(),
  };
}

describe('dos corridas simultáneas del cron de programadas', () => {
  it('solo sale UN push aunque las dos corridas vean la misma fila pendiente', async () => {
    const e = entorno();

    await Promise.all([e.corrida(), e.corrida()]);

    // Las dos leyeron la lista y las dos vieron la fila pendiente...
    expect(e.lecturas()).toBe(2);
    // ...pero solo una ganó el claim y solo una envió.
    expect(e.pushes).toHaveLength(1);
  });

  it('tres corridas a la vez tampoco multiplican el envío', async () => {
    const e = entorno();

    await Promise.all([e.corrida(), e.corrida(), e.corrida()]);

    expect(e.pushes).toHaveLength(1);
  });

  it('la fila queda marcada como enviada', async () => {
    const e = entorno();

    await Promise.all([e.corrida(), e.corrida()]);

    expect(e.fila.sentAt).toBeInstanceOf(Date);
  });

  it('una programada que YA se envió no se reenvía', async () => {
    const e = entorno(new Date());

    await e.corrida();

    expect(e.pushes).toHaveLength(0);
  });
});

describe('el cerrojo del propio proceso', () => {
  it('si el tick anterior sigue en curso, el siguiente no vuelve a recorrer', async () => {
    const e = entorno();

    // `dispatchScheduled` es lo que llama el cron: el segundo debe rebotar.
    await Promise.all([e.svc.dispatchScheduled(), e.svc.dispatchScheduled()]);

    expect(e.lecturas()).toBe(1);
    expect(e.pushes).toHaveLength(1);
  });
});

/**
 * El mismo escenario con el código VIEJO, para dejar constancia de que el
 * fallo era real y de que lo que lo arregla es mirar el `count`.
 */
describe('por qué el update por id no bastaba', () => {
  it('con `update` incondicional las dos corridas envían', async () => {
    const fila: any = { id: 'n1', sentAt: null };
    const pushes: string[] = [];

    const viejo = async () => {
      // (1) lee: las dos corridas se llevan la fila todavía pendiente, que es
      // lo que pasa cuando el tick de las 10:05 arranca con el de las 10:00
      // aún despachando pases.
      const due = fila.sentAt === null ? [{ ...fila }] : [];
      await cede();
      for (const n of due) {
        // (2) escribe sin condición: no dice si alguien se adelantó
        fila.sentAt = new Date();
        // (3) envía igualmente
        pushes.push(n.id);
      }
    };

    await Promise.all([viejo(), viejo()]);

    expect(pushes).toHaveLength(2); // el bug, reproducido
  });
});
