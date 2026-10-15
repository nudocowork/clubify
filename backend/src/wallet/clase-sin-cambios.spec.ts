import { describe, it, expect } from 'vitest';
import { GoogleWalletService } from './google-wallet.service';

/**
 * Reescribir una clase de Google Wallet SIN cambios avisa a quienes tienen la
 * tarjeta. Caso Aldehir (Hacienda Don Antonio, 2026-10-14): un sello en caja a
 * otro cliente, a las 10:20 p. m., reescribió la clase porque la memoria de 10
 * minutos había caducado, y a él le llegó «Mensaje nuevo» en su casa.
 *
 * La firma de lo último escrito vive ahora en la base: sobrevive a la
 * caducidad y a un reinicio, y la clase solo se toca cuando cambia.
 */
function montar(settings: Map<string, string>) {
  const prisma = {
    setting: {
      findUnique: async ({ where }: any) =>
        settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null,
      upsert: async ({ where, update }: any) => {
        settings.set(where.key, update.value);
        return { key: where.key, value: update.value };
      },
      deleteMany: async ({ where }: any) => {
        settings.delete(where.key);
        return { count: 1 };
      },
    },
  };
  const svc = new GoogleWalletService(prisma as any, {} as any);
  const parches: unknown[] = [];
  const wallet = {
    loyaltyclass: {
      patch: async (req: any) => {
        parches.push(req.requestBody);
        return {};
      },
      insert: async () => ({}),
    },
  };
  return { svc: svc as any, wallet, parches };
}

const esperar = () => new Promise((r) => setTimeout(r, 0));

describe('la clase de Google solo se reescribe si cambió', () => {
  it('tras un reinicio (memoria vacía) no se reescribe una clase igual', async () => {
    const settings = new Map<string, string>();
    const cuerpo = { id: 'c1', programName: 'Hacienda', hexBackgroundColor: '#123456' };

    const a = montar(settings);
    expect(await a.svc.asegurarClase(a.wallet, 'c1', cuerpo)).toBe(true);
    await esperar();
    expect(a.parches).toHaveLength(1);

    // Otro proceso / reinicio: sin memoria, con la base.
    const b = montar(settings);
    expect(await b.svc.asegurarClase(b.wallet, 'c1', { ...cuerpo })).toBe(true);
    expect(b.parches).toHaveLength(0);
  });

  it('si cambió (otro color) sí se reescribe', async () => {
    const settings = new Map<string, string>();
    const a = montar(settings);
    await a.svc.asegurarClase(a.wallet, 'c1', { id: 'c1', hexBackgroundColor: '#111111' });
    await esperar();
    const b = montar(settings);
    await b.svc.asegurarClase(b.wallet, 'c1', { id: 'c1', hexBackgroundColor: '#222222' });
    expect(b.parches).toHaveLength(1);
  });

  it('si Google dice que la clase no existe, se olvida la firma y se vuelve a escribir', async () => {
    const settings = new Map<string, string>();
    const cuerpo = { id: 'c1', programName: 'Hacienda' };
    const a = montar(settings);
    await a.svc.asegurarClase(a.wallet, 'c1', cuerpo);
    await esperar();
    a.svc.olvidarClase('c1');
    await esperar();
    await a.svc.asegurarClase(a.wallet, 'c1', cuerpo);
    expect(a.parches).toHaveLength(2);
  });
});
