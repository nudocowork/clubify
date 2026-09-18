import { describe, it, expect, vi } from 'vitest';
import { AutomationsService } from './automations.service';

/**
 * El sello automático al inscribirse (acción «Sumar sellos»).
 *
 * EL FALLO (Chillin Sports & Wings, vía Javier, 2026-09-18): «no se le está
 * dando el sello automático al cliente por descargar la tarjeta… me dice que lo
 * tiene habilitado». Lo tenía: la regla estaba activa, con su disparador y su
 * acción. Lo que estaba mal era lo GUARDADO —
 *
 *     {"body":"","type":"ADD_STAMPS","title":""}
 *
 * — sin `amount`. El panel, al cambiarle el tipo a una acción, conservaba los
 * campos de la anterior y no ponía los nuevos; el input enseñaba «1» pero no lo
 * escribía si no lo tocabas. Con `amount` a `undefined`, el `increment` no
 * sumaba nada.
 *
 * El dato que cerró el diagnóstico: en TODA la plataforma había **cero** sellos
 * con la nota «Por automation». No es que fallara en un negocio — no funcionó
 * nunca, para nadie, y el panel marcaba la regla como correcta.
 *
 * Tres cosas se prueban aquí, y las tres eran defectos distintos:
 *  1. una regla vieja, ya guardada sin `amount`, ahora sella igual;
 *  2. el pase se REFRESCA (si no, el sello entra en la base y el cliente
 *     sigue viendo su tarjeta a cero, que para él es no habérselo dado);
 *  3. con varias tarjetas de sellos, se sella la que diga la regla.
 */

function servicio(opts: {
  tarjetas: Array<{ id: string; name: string; type?: string }>;
  pases: Array<{ id: string; cardId: string; customerId: string }>;
}) {
  const sellos: any[] = [];
  const incrementos: any[] = [];
  const refrescados: string[] = [];

  const prisma: any = {
    card: {
      findFirst: async ({ where }: any) => {
        // Reproduce el `where` real: por id, o la primera de SELLOS activa.
        if (where.id) return opts.tarjetas.find((c) => c.id === where.id) ?? null;
        return opts.tarjetas.find((c) => (c.type ?? 'STAMPS') === 'STAMPS') ?? null;
      },
    },
    pass: {
      findUnique: async ({ where }: any) => {
        const { cardId, customerId } = where.cardId_customerId;
        return opts.pases.find((p) => p.cardId === cardId && p.customerId === customerId) ?? null;
      },
      update: async ({ where, data }: any) => {
        incrementos.push({ passId: where.id, increment: data.stampsCount?.increment });
        return {};
      },
    },
    stamp: { create: async ({ data }: any) => { sellos.push(data); return data; } },
    $transaction: async (ops: any[]) => Promise.all(ops),
  };

  const wallet: any = {
    pushPassUpdate: vi.fn(async (id: string) => { refrescados.push(id); }),
  };

  const svc = new AutomationsService(prisma, {} as any, wallet, {} as any);
  // `executeAction` es privado: se llama por su nombre porque lo que importa es
  // el comportamiento observable, no el modificador de acceso.
  const ejecutar = (action: any, payload: any) =>
    (svc as any).executeAction(action, payload, 'regla-1');

  return { ejecutar, sellos, incrementos, refrescados, wallet };
}

const PAYLOAD = { tenantId: 't1', customerId: 'c1' };

describe('el sello al inscribirse', () => {
  it('una regla guardada SIN «amount» —la de Chillin— ahora sí sella', async () => {
    const s = servicio({
      tarjetas: [{ id: 'card-1', name: 'Chillin' }],
      pases: [{ id: 'pass-1', cardId: 'card-1', customerId: 'c1' }],
    });
    // Exactamente lo que había guardado en producción.
    await s.ejecutar({ body: '', type: 'ADD_STAMPS', title: '' }, PAYLOAD);

    expect(s.sellos).toHaveLength(1);
    expect(s.sellos[0].amount).toBe(1);
    expect(s.incrementos[0].increment).toBe(1);
  });

  it('el pase se refresca: sin eso el cliente sigue viendo su tarjeta en cero', async () => {
    const s = servicio({
      tarjetas: [{ id: 'card-1', name: 'Chillin' }],
      pases: [{ id: 'pass-1', cardId: 'card-1', customerId: 'c1' }],
    });
    await s.ejecutar({ type: 'ADD_STAMPS', amount: 2 }, PAYLOAD);

    expect(s.incrementos[0].increment).toBe(2);
    expect(s.refrescados).toEqual(['pass-1']);
  });

  it('con varias tarjetas de sellos, sella la que dice la regla', async () => {
    // Chillin tiene dos: «Chillin Express» y «Chillin Sports & Wings». Sin
    // elegir, el backend cogía «la primera activa» sin ningún orden, y si era
    // la que el cliente NO instaló no encontraba pase y no hacía nada.
    const s = servicio({
      tarjetas: [
        { id: 'express', name: 'Chillin Express' },
        { id: 'principal', name: 'Chillin Sports & Wings' },
      ],
      pases: [{ id: 'pass-2', cardId: 'principal', customerId: 'c1' }],
    });
    await s.ejecutar({ type: 'ADD_STAMPS', amount: 1, cardId: 'principal' }, PAYLOAD);

    expect(s.sellos).toHaveLength(1);
    expect(s.sellos[0].passId).toBe('pass-2');
    expect(s.refrescados).toEqual(['pass-2']);
  });

  it('si el cliente no tiene pase de esa tarjeta, no sella ni revienta', async () => {
    const s = servicio({
      tarjetas: [{ id: 'express', name: 'Chillin Express' }],
      pases: [{ id: 'pass-2', cardId: 'principal', customerId: 'c1' }],
    });
    await s.ejecutar({ type: 'ADD_STAMPS', amount: 1 }, PAYLOAD);

    expect(s.sellos).toHaveLength(0);
    expect(s.refrescados).toEqual([]);
  });

  it('un «amount» absurdo no se cuela', async () => {
    const s = servicio({
      tarjetas: [{ id: 'card-1', name: 'Chillin' }],
      pases: [{ id: 'pass-1', cardId: 'card-1', customerId: 'c1' }],
    });
    for (const malo of [0, -5, 'abc', null]) {
      s.sellos.length = 0;
      await s.ejecutar({ type: 'ADD_STAMPS', amount: malo }, PAYLOAD);
      expect(s.sellos[0].amount).toBe(1);
    }
  });
});
