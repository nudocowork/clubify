import { describe, it, expect, vi } from 'vitest';
import { NotificationsService } from './notifications.service';

/**
 * El envío manual de notificaciones no puede colgar la petición HTTP.
 *
 * EL FALLO (2026-09-11, reportado por Javier): «al intentar enviarlas se
 * demora mucho y al final no se envían». El panel se quedaba en «Enviando…»
 * indefinidamente.
 *
 * La causa no era el push, era la forma: `POST /notifications` recorría los
 * pases de UNO EN UNO —PATCH a Google + conexión TLS nueva con Apple por
 * pase— y no respondía hasta terminar. Con 141 pases (Fusion sushi) eso son
 * minutos; el navegador corta antes, el negocio cree que no salió y le da
 * otra vez. En producción quedaron dos envíos idénticos a Fusion sushi con 4
 * minutos de diferencia, y uno a 301 pases que se quedó a medias.
 *
 * Lo que se prueba aquí es justo eso: que responde ya, y que por detrás no va
 * en fila india.
 */

function servicio(nPases: number, msPorPush = 20) {
  const passes = Array.from({ length: nPases }, (_, i) => ({
    id: `p${i}`,
    googleObjectId: `g${i}`,
    walletDevices: [{ id: `d${i}` }],
  }));

  let enVuelo = 0;
  let picoEnVuelo = 0;
  const updatesDePase: string[] = [];
  let updateManyDePases = 0;
  const statsEscritos: any[] = [];
  let creada: any = null;

  const prisma: any = {
    pass: {
      findMany: async () => passes,
      update: async ({ where }: any) => {
        updatesDePase.push(where.id);
        return {};
      },
      updateMany: async () => {
        updateManyDePases += 1;
        return { count: passes.length };
      },
    },
    notification: {
      create: async ({ data }: any) => {
        creada = { id: 'n1', ...data };
        return creada;
      },
      update: async ({ data }: any) => {
        statsEscritos.push(data.stats);
        return { id: 'n1', ...data };
      },
    },
  };

  const wallet: any = {
    pushPassUpdate: async () => {
      enVuelo += 1;
      picoEnVuelo = Math.max(picoEnVuelo, enVuelo);
      await new Promise((r) => setTimeout(r, msPorPush));
      enVuelo -= 1;
      return { sent: 1, google: { ok: true } };
    },
  };

  const srv = new NotificationsService(prisma, wallet) as any;
  return {
    srv,
    verPico: () => picoEnVuelo,
    verUpdatesDePase: () => updatesDePase,
    verUpdateMany: () => updateManyDePases,
    verStats: () => statsEscritos,
    verCreada: () => creada,
  };
}

const USUARIO = { role: 'TENANT_OWNER', tenantId: 't1' } as any;
const MENSAJE = { title: 'Promo', body: 'Pasa hoy' };

describe('envío manual de notificaciones', () => {
  it('responde SIN esperar a que salgan los pushes', async () => {
    // 40 pases a 50 ms cada uno: en fila india serían 2 segundos. La respuesta
    // no puede depender de eso.
    const c = servicio(40, 50);
    const t0 = Date.now();
    await c.srv.send(USUARIO, MENSAJE);
    expect(Date.now() - t0).toBeLessThan(300);
  });

  it('la respuesta ya dice a cuántos va, y que sigue en curso', async () => {
    const c = servicio(10);
    const r = await c.srv.send(USUARIO, MENSAJE);
    // 10 pases × (1 dispositivo Apple + 1 objeto de Google).
    expect(r.stats.targeted).toBe(20);
    expect(r.stats.delivered).toBe(0);
    expect(r.stats.enCurso).toBe(true);
    expect(r.sentAt).toBeInstanceOf(Date);
  });

  it('despacha en paralelo, no de uno en uno', async () => {
    const c = servicio(24, 30);
    await c.srv.send(USUARIO, MENSAJE);
    await vi.waitFor(() => expect(c.verPico()).toBeGreaterThan(1), {
      timeout: 3000,
    });
  });

  it('pero con un tope: no abre 500 conexiones de golpe', async () => {
    // Sin tope, un negocio grande dispara todos los pases a la vez contra
    // Apple y Google y se lleva un rate-limit.
    const c = servicio(60, 20);
    await c.srv.send(USUARIO, MENSAJE);
    await vi.waitFor(
      () => {
        const fin = c.verStats().find((s: any) => !s.enCurso);
        expect(fin).toBeDefined();
      },
      { timeout: 5000 },
    );
    expect(c.verPico()).toBeLessThanOrEqual(8);
  });

  it('al terminar deja el recuento real y quita el «en curso»', async () => {
    const c = servicio(5, 5);
    await c.srv.send(USUARIO, MENSAJE);
    await vi.waitFor(
      () => {
        const fin = c.verStats().find((s: any) => !s.enCurso);
        expect(fin).toEqual({ targeted: 10, delivered: 10, opened: 0 });
      },
      { timeout: 3000 },
    );
  });

  it('no escribe una fila por pase para marcar la actividad', async () => {
    // Eran N escrituras sueltas dentro del bucle, una por pase, que no
    // aportaban nada al push y sumaban al tiempo total.
    const c = servicio(30, 1);
    await c.srv.send(USUARIO, MENSAJE);
    await vi.waitFor(
      () => {
        const fin = c.verStats().find((s: any) => !s.enCurso);
        expect(fin).toBeDefined();
      },
      { timeout: 3000 },
    );
    expect(c.verUpdatesDePase()).toEqual([]);
    expect(c.verUpdateMany()).toBe(1);
  });

  it('un push que revienta no se lleva por delante el resto del envío', async () => {
    const c = servicio(6, 1);
    let n = 0;
    c.srv.wallet.pushPassUpdate = async () => {
      n += 1;
      if (n === 2) throw new Error('APNs caído');
      return { sent: 1, google: { ok: true } };
    };
    await c.srv.send(USUARIO, MENSAJE);
    await vi.waitFor(
      () => {
        const fin = c.verStats().find((s: any) => !s.enCurso);
        // 6 pases × 2 destinos (Apple + Google) = 12 contados. Uno revienta
        // → los 5 restantes entregan sus 2 cada uno.
        expect(fin?.delivered).toBe(10);
        expect(fin?.targeted).toBe(12);
      },
      { timeout: 3000 },
    );
  });
});
