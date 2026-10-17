import { describe, it, expect } from 'vitest';
import { PreregAlertsService } from './prereg-alerts.service';

/**
 * Un aviso al equipo sobre un cliente de una MARCA BLANCA va al dueño de esa
 * marca, por su línea, y nunca al equipo de Clubify. Caso: los «Cliente sin
 * registrarse» de Sellea le llegaban a Javier y a Jhon (2026-10-17).
 */
function montar(marcas: Record<string, any>) {
  const enviados: Array<{ locationId: string; telefono: string; texto: string }> = [];
  const prisma = {
    whiteLabel: { findUnique: async ({ where }: any) => marcas[where.id] ?? null },
    setting: {
      findUnique: async ({ where }: any) =>
        where.key === 'prereg.alertPhones'
          ? { value: JSON.stringify([{ name: 'Javier', phone: '+570000000001' }]) }
          : null,
    },
    growBusinessAccount: {
      findFirst: async () => ({ id: 'g', locationId: 'loc-clubify', apiKey: 'k', switchNumber: null }),
      findUnique: async () => ({ id: 'g', locationId: 'loc-clubify', apiKey: 'k', switchNumber: null }),
    },
  };
  const growBusiness = {
    sendSmsWithCreds: async (creds: any, telefono: string, texto: string) => {
      enviados.push({ locationId: creds.locationId, telefono, texto });
      return { ok: true };
    },
  };
  return { svc: new PreregAlertsService(prisma as any, growBusiness as any), enviados };
}

const SELLEA = {
  slug: 'sellea', name: 'Sellea', notifyPhone: '+17860000000',
  growBusinessLocationId: 'loc-sellea', growBusinessApiKey: 'clave-en-claro', growBusinessSwitchNumber: null,
};

describe('avisos al equipo de una marca blanca', () => {
  it('van al dueño de la marca por la línea de la marca, no al equipo de Clubify', async () => {
    const { svc, enviados } = montar({ wl1: SELLEA });
    const r = await svc.sendTeamAlert('🔔 Cliente sin registrarse', 'implementacion', { whiteLabelId: 'wl1' });
    expect(r.ok).toBe(true);
    expect(enviados).toEqual([
      { locationId: 'loc-sellea', telefono: '+17860000000', texto: '🔔 Cliente sin registrarse' },
    ]);
  });

  it('sin teléfono de la marca no se envía a nadie (nunca cae al equipo de Clubify)', async () => {
    const { svc, enviados } = montar({ wl1: { ...SELLEA, notifyPhone: null } });
    const r = await svc.sendTeamAlert('🔔 aviso', 'implementacion', { whiteLabelId: 'wl1' });
    expect(r.ok).toBe(false);
    expect(enviados).toHaveLength(0);
  });

  it('sin línea propia usa la de la plataforma, pero igual al dueño de la marca', async () => {
    const { svc, enviados } = montar({
      wl1: { ...SELLEA, growBusinessLocationId: null, growBusinessApiKey: null },
    });
    await svc.sendTeamAlert('🔔 otro aviso', 'implementacion', { whiteLabelId: 'wl1' });
    expect(enviados.map((e) => e.telefono)).toEqual(['+17860000000']);
  });

  it('la marca Clubify sigue yendo al equipo', async () => {
    const { svc, enviados } = montar({ wlc: { ...SELLEA, slug: 'clubify', name: 'Clubify' } });
    await svc.sendTeamAlert('🎉 Nueva compra Clubify', 'nueva_compra', { whiteLabelId: 'wlc' });
    expect(enviados.map((e) => e.telefono)).toEqual(['+570000000001']);
  });
});
