import { describe, it, expect } from 'vitest';
import { NotificationsService } from './notifications.service';

/**
 * Dos fallos que encontró la revisión del arreglo de las programadas.
 *
 * 1. EL CERROJO NO CADUCABA. Guardaba un booleano, y `pushPassUpdate` no tiene
 *    timeout: si un push a Apple o Google se queda colgado, `enTandas` no
 *    resuelve nunca, el `finally` no llega y el cerrojo se queda cerrado para
 *    siempre. Eso apagaba TODAS las programadas de TODOS los negocios hasta el
 *    siguiente reinicio, con un warn cada 5 minutos que no mira nadie. Antes
 *    del cerrojo, un tick colgado perdía sus filas pero el siguiente seguía;
 *    hay que conservar esa propiedad.
 *
 * 2. FILA MARCADA Y NO ENVIADA. `sentAt` se pone ANTES de despachar (es el
 *    claim que evita el doble envío), así que si `despachar` revienta la fila
 *    queda como «enviada» y nadie la reintenta: el negocio la ve enviada y al
 *    cliente no le llegó nada.
 */

const cede = () => new Promise((r) => setTimeout(r, 0));
const CADUCIDAD_MS = 15 * 60 * 1000;

function entorno(opts: {
  stats?: unknown;
  fallaAlBuscarPases?: boolean;
  fallaAlCerrar?: boolean;
  pases?: number;
} = {}) {
  const fila: any = {
    id: 'n1',
    tenantId: 't1',
    cardId: null,
    customerId: null,
    title: 'Promo de la tarde',
    body: '2x1 hasta las 6',
    triggerType: 'SCHEDULED',
    scheduledAt: new Date(Date.now() - 60_000),
    sentAt: null,
    stats: opts.stats ?? {},
  };

  const pushes: string[] = [];
  let lecturas = 0;

  const prisma: any = {
    notification: {
      findMany: async () => {
        lecturas += 1;
        const foto = fila.sentAt === null ? [{ ...fila }] : [];
        await cede();
        return foto;
      },
      updateMany: async ({ where, data }: any) => {
        if (where.id !== fila.id) return { count: 0 };
        if (where.sentAt === null && fila.sentAt !== null) return { count: 0 };
        if (where.sentAt?.not === null && fila.sentAt === null) return { count: 0 };
        Object.assign(fila, data);
        return { count: 1 };
      },
      update: async ({ data }: any) => {
        if (opts.fallaAlCerrar) throw new Error('la base se cayó al cerrar');
        Object.assign(fila, data);
        return { ...fila };
      },
    },
    pass: {
      findMany: async () => {
        if (opts.fallaAlBuscarPases) throw new Error('la base se cayó');
        return Array.from({ length: opts.pases ?? 1 }, (_, i) => ({
          id: `p${i}`,
          googleObjectId: `g${i}`,
          walletDevices: [{ id: `d${i}` }],
        }));
      },
      updateMany: async () => ({ count: 1 }),
    },
  };

  const wallet: any = {
    pushPassUpdate: async (id: string) => {
      pushes.push(id);
      await cede();
      return { sent: 1, google: { ok: true } };
    },
  };

  const svc = new NotificationsService(prisma, wallet);
  return { svc, fila, pushes, lecturas: () => lecturas };
}

describe('el cerrojo del cron caduca', () => {
  it('un tick reciente sí bloquea al siguiente', async () => {
    const e = entorno();
    // Un tick que arrancó hace un minuto sigue siendo válido.
    (e.svc as any).despachoProgramadasArrancadoEn = Date.now() - 60_000;

    await e.svc.dispatchScheduled();

    expect(e.lecturas()).toBe(0); // no recorrió nada
  });

  it('un tick COLGADO no apaga los envíos para siempre', async () => {
    const e = entorno();
    // Un push colgado hace 16 minutos: el `finally` nunca llegó.
    (e.svc as any).despachoProgramadasArrancadoEn = Date.now() - (CADUCIDAD_MS + 60_000);

    await e.svc.dispatchScheduled();

    // Si el cerrojo no caducara, esto sería 0 y los 126 negocios se habrían
    // quedado sin programadas hasta el siguiente reinicio.
    expect(e.lecturas()).toBe(1);
    expect(e.pushes).toHaveLength(1);
  });

  it('justo en el límite todavía bloquea (no se abre antes de tiempo)', async () => {
    const e = entorno();
    (e.svc as any).despachoProgramadasArrancadoEn = Date.now() - (CADUCIDAD_MS - 5_000);

    await e.svc.dispatchScheduled();

    expect(e.lecturas()).toBe(0);
  });

  it('al terminar bien, el cerrojo queda suelto para el próximo tick', async () => {
    const e = entorno();

    await e.svc.dispatchScheduled();

    expect((e.svc as any).despachoProgramadasArrancadoEn).toBeNull();
  });
});

describe('una programada que se marcó y luego falló', () => {
  it('si NO se envió a nadie, vuelve a pendiente para reintentarla', async () => {
    const e = entorno({ fallaAlBuscarPases: true });

    await (e.svc as any).recorrerProgramadasVencidas();

    expect(e.pushes).toHaveLength(0);
    // Lo que importa: no se queda marcada como enviada sin haberlo estado.
    expect(e.fila.sentAt).toBeNull();
    expect(e.fila.stats.intentos).toBe(1);
  });

  it('si se envió A MEDIAS, NO se reintenta (duplicaría a quien ya la tiene)', async () => {
    // Los pases se empujan bien y revienta al cerrar: hechos > 0.
    const e = entorno({ fallaAlCerrar: true, pases: 3 });

    await (e.svc as any).recorrerProgramadasVencidas();

    expect(e.pushes).toHaveLength(3);
    expect(e.fila.sentAt).not.toBeNull(); // sigue marcada, a propósito
  });

  it('no se reintenta para siempre: al tercer intento se abandona', async () => {
    const e = entorno({ fallaAlBuscarPases: true, stats: { intentos: 2 } });

    await (e.svc as any).recorrerProgramadasVencidas();

    // Con el tope, deja de resucitarla cada 5 minutos.
    expect(e.fila.sentAt).not.toBeNull();
    expect(e.fila.stats.abandonada).toBe(true);
  });

  it('un despacho que va bien no toca nada de esto', async () => {
    const e = entorno();

    await (e.svc as any).recorrerProgramadasVencidas();

    expect(e.pushes).toHaveLength(1);
    expect(e.fila.sentAt).toBeInstanceOf(Date);
    expect(e.fila.stats.abandonada).toBeUndefined();
  });
});
