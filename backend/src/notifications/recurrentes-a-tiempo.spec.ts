import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { RecurringNotificationsService } from './recurring-notifications.service';
import { entregadosDelPush } from './envio-en-tandas';
import { GoogleWalletService } from '../wallet/google-wallet.service';

// Caso real (2026-10-01): «a Aldehir no le llegan las programadas a la hora».
// El servidor sí disparaba, pero en FILA: su «GASEOSA GRATIS» de las 12:00
// arrancaba a las 12:04–12:09 los días en que otros dos negocios también
// enviaban a las 12:00, y a las 12:00 en punto los días que no.

type Sched = {
  id: string;
  tenantId: string;
  cardId: string | null;
  title: string;
  body: string;
  segment: unknown;
  daysOfWeek: number[];
  timeOfDay: string;
  timezone: string;
  isActive: boolean;
  lastDispatchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  tenant: { timezone: string };
};

const TODOS_LOS_DIAS = [0, 1, 2, 3, 4, 5, 6];

function sched(p: Partial<Sched> & { id: string }): Sched {
  return {
    tenantId: `t-${p.id}`,
    cardId: null,
    title: 'Promo',
    body: 'Texto',
    segment: {},
    daysOfWeek: TODOS_LOS_DIAS,
    timeOfDay: '12:00',
    timezone: 'America/Bogota',
    isActive: true,
    lastDispatchedAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-30T17:00:00Z'),
    tenant: { timezone: 'America/Lima' },
    ...p,
  };
}

function montar(
  schedules: Sched[],
  pases: Record<string, number>,
  push: (passId: string) => Promise<any> = async () => ({
    sent: 0,
    google: { ok: true, status: 'patched', notified: true },
  }),
) {
  const svc = Object.create(RecurringNotificationsService.prototype) as any;
  svc.logger = new Logger('test');
  vi.spyOn(svc.logger, 'log').mockImplementation(() => undefined);
  vi.spyOn(svc.logger, 'warn').mockImplementation(() => undefined);
  const notifs: any[] = [];
  svc.prisma = {
    recurringNotification: {
      findMany: vi.fn(async () => schedules),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    notification: {
      create: vi.fn(async ({ data }: any) => {
        const n = { id: `n${notifs.length}`, ...data };
        notifs.push(n);
        return n;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const n = notifs.find((x) => x.id === where.id);
        Object.assign(n, data);
        return n;
      }),
    },
    pass: {
      findMany: vi.fn(async ({ where }: any) =>
        Array.from({ length: pases[where.tenantId] ?? 0 }, (_, i) => ({
          id: `${where.tenantId}-p${i}`,
          googleObjectId: `g${i}`,
          walletDevices: [],
        })),
      ),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  svc.wallet = { pushPassUpdate: vi.fn(push) };
  return { svc, notifs };
}

/** Fija el reloj sin congelar promesas ni temporizadores. */
function relojEn(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('recurrentes: a la hora, para todos los negocios', () => {
  it('dos negocios a la misma hora arrancan A LA VEZ, no uno detrás del otro', async () => {
    relojEn('2026-10-01T17:00:10Z'); // 12:00 en Lima
    const arranques: Record<string, number> = {};
    let soltarGrande!: () => void;
    const grandeEnCurso = new Promise<void>((r) => (soltarGrande = r));
    const { svc } = montar(
      [sched({ id: 'grande' }), sched({ id: 'pequeno' })],
      { 't-grande': 3, 't-pequeno': 1 },
      async (passId) => {
        const t = passId.split('-')[1];
        arranques[t] ??= Date.now();
        // El grande no termina hasta que el pequeño ya haya empezado.
        if (t === 'grande') await grandeEnCurso;
        return { sent: 0, google: { ok: true, notified: true } };
      },
    );
    const corrida = svc.dispatchDue();
    await vi.waitFor(() => expect(arranques.pequeno).toBeDefined());
    soltarGrande();
    await corrida;
    expect(svc.wallet.pushPassUpdate).toHaveBeenCalledTimes(4);
  });

  it('los pases van por tandas: nunca más de 6 en vuelo, y más de 1', async () => {
    relojEn('2026-10-01T17:00:10Z');
    let enVuelo = 0;
    let maximo = 0;
    const { svc } = montar([sched({ id: 'a' })], { 't-a': 20 }, async () => {
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      await new Promise((r) => setTimeout(r, 1));
      enVuelo--;
      return { sent: 0, google: { ok: true, notified: true } };
    });
    await svc.dispatchDue();
    expect(svc.wallet.pushPassUpdate).toHaveBeenCalledTimes(20);
    expect(maximo).toBeGreaterThan(1);
    expect(maximo).toBeLessThanOrEqual(6);
  });

  it('la hora se lee en la zona DEL NEGOCIO (Nueva York en horario de verano)', async () => {
    // 10:00 en Nueva York (EDT, UTC-4) = 14:00 UTC; en Bogotá serían las 9:00.
    relojEn('2026-10-01T14:00:10Z');
    const ny = sched({ id: 'ny', timeOfDay: '10:00', tenant: { timezone: 'America/New_York' } });
    const { svc } = montar([ny], { 't-ny': 1 });
    await svc.dispatchDue();
    expect(svc.wallet.pushPassUpdate).toHaveBeenCalledTimes(1);

    // A las 10:00 de Bogotá (15:00 UTC) en Nueva York ya son las 11:00.
    relojEn('2026-10-01T15:00:10Z');
    const otro = montar([ny], { 't-ny': 1 });
    await otro.svc.dispatchDue();
    expect(otro.svc.wallet.pushPassUpdate).not.toHaveBeenCalled();
  });

  it('un tick perdido (despliegue) se recupera dentro de la media hora', async () => {
    relojEn('2026-10-01T17:20:10Z'); // 12:20 en Lima
    const { svc } = montar([sched({ id: 'a' })], { 't-a': 1 });
    await svc.dispatchDue();
    expect(svc.wallet.pushPassUpdate).toHaveBeenCalledTimes(1);
  });

  it('pasada la media hora ya no se envía: un aviso de las 12:00 a las 13:00 es ruido', async () => {
    relojEn('2026-10-01T17:35:10Z');
    const { svc } = montar([sched({ id: 'a' })], { 't-a': 1 });
    await svc.dispatchDue();
    expect(svc.wallet.pushPassUpdate).not.toHaveBeenCalled();
  });

  it('creada o editada DESPUÉS de la hora de hoy, no se «recupera» en el acto', async () => {
    relojEn('2026-10-01T17:20:10Z');
    const recien = sched({ id: 'a', updatedAt: new Date('2026-10-01T17:12:00Z') });
    const { svc } = montar([recien], { 't-a': 1 });
    await svc.dispatchDue();
    expect(svc.wallet.pushPassUpdate).not.toHaveBeenCalled();
  });

  it('si el claim lo ganó otra corrida, no se envía', async () => {
    relojEn('2026-10-01T17:00:10Z');
    const { svc } = montar([sched({ id: 'a' })], { 't-a': 2 });
    svc.prisma.recurringNotification.updateMany = vi.fn(async () => ({ count: 0 }));
    await svc.dispatchDue();
    expect(svc.wallet.pushPassUpdate).not.toHaveBeenCalled();
  });

  it('una recurrencia que revienta no tumba a las demás', async () => {
    relojEn('2026-10-01T17:00:10Z');
    const { svc, notifs } = montar([sched({ id: 'rota' }), sched({ id: 'sana' })], {
      't-rota': 1,
      't-sana': 2,
    });
    const original = svc.prisma.pass.findMany;
    svc.prisma.pass.findMany = vi.fn(async (args: any) => {
      if (args.where.tenantId === 't-rota') throw new Error('base caída');
      return original(args);
    });
    await svc.dispatchDue();
    const sana = notifs.find((n) => n.tenantId === 't-sana');
    expect(sana.stats).toMatchObject({ targeted: 2, delivered: 2 });
  });
});

describe('«entregados» cuenta notificaciones, no tarjetas actualizadas', () => {
  it('Google solo suma si salió el aviso (`notified`)', () => {
    expect(entregadosDelPush({ sent: 0, google: { ok: true, notified: true } })).toBe(1);
    expect(entregadosDelPush({ sent: 0, google: { ok: true, notified: false } })).toBe(0);
    expect(entregadosDelPush({ sent: 2, google: { ok: false } })).toBe(2);
    expect(entregadosDelPush(null)).toBe(0);
  });
});

describe('Google: la clase de la tarjeta se escribe una vez por envío', () => {
  function google() {
    const svc = Object.create(GoogleWalletService.prototype) as any;
    svc.logger = new Logger('test');
    vi.spyOn(svc.logger, 'log').mockImplementation(() => undefined);
    vi.spyOn(svc.logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(svc.logger, 'error').mockImplementation(() => undefined);
    svc.clasesEscritas = new Map();
    svc.clasesEnVuelo = new Map();
    const wallet = {
      loyaltyclass: {
        patch: vi.fn(async () => {
          await new Promise((r) => setTimeout(r, 1));
          return {};
        }),
        insert: vi.fn(async () => ({})),
      },
    };
    return { svc, wallet };
  }

  it('8 pases en paralelo con la misma clase: UN solo patch', async () => {
    const { svc, wallet } = google();
    const cuerpo = { id: 'c1', programName: 'Hacienda' };
    const r = await Promise.all(
      Array.from({ length: 8 }, () => svc.asegurarClase(wallet, 'c1', cuerpo)),
    );
    expect(r.every(Boolean)).toBe(true);
    expect(wallet.loyaltyclass.patch).toHaveBeenCalledTimes(1);
    // Y el envío siguiente, con la clase igual, tampoco la reescribe.
    await svc.asegurarClase(wallet, 'c1', { ...cuerpo });
    expect(wallet.loyaltyclass.patch).toHaveBeenCalledTimes(1);
  });

  it('si cambió el cuerpo (logo, color), se reescribe en el acto', async () => {
    const { svc, wallet } = google();
    await svc.asegurarClase(wallet, 'c1', { logo: 'a.png' });
    await svc.asegurarClase(wallet, 'c1', { logo: 'b.png' });
    expect(wallet.loyaltyclass.patch).toHaveBeenCalledTimes(2);
  });

  it('un fallo de red NO se recuerda como escrita: el siguiente lo reintenta', async () => {
    const { svc, wallet } = google();
    wallet.loyaltyclass.patch.mockRejectedValueOnce(Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' }));
    expect(await svc.asegurarClase(wallet, 'c1', { a: 1 })).toBe(true);
    await svc.asegurarClase(wallet, 'c1', { a: 1 });
    expect(wallet.loyaltyclass.patch).toHaveBeenCalledTimes(2);
  });

  it('la clase que no existe se crea, y si no se puede crear el pase no sigue', async () => {
    const { svc, wallet } = google();
    wallet.loyaltyclass.patch.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 404 }));
    wallet.loyaltyclass.insert.mockRejectedValueOnce(new Error('denegado'));
    expect(await svc.asegurarClase(wallet, 'c1', { a: 1 })).toBe(false);
  });
});
