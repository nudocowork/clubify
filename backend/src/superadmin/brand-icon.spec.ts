import { describe, it, expect, vi, afterEach } from 'vitest';
import sharp from 'sharp';
import { BrandIconService } from './brand-icon.service';

/**
 * El icono de marca/negocio generado al vuelo (`GET
 * /superadmin-public/white-labels/icon`, PÚBLICO: lo pide el `<head>` de cada
 * menú, InfoLink y panel).
 *
 * EL FALLO (arqueo 2026-09-17): cada petición descargaba el logo con `fetch`
 * SIN tiempo máximo ni tope de tamaño y lo pasaba por `sharp`. Un logo en un
 * servidor lento colgaba la petición; uno de cientos de megas entraba entero
 * en memoria; y pedir el mismo icono mil veces eran mil descargas y mil
 * `sharp`.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function montar(logoUrl: string, veces = { consultas: 0 }) {
  const prisma: any = {
    tenant: {
      findUnique: async () => {
        veces.consultas++;
        return { logoUrl, walletLogoUrl: null, primaryColor: '#123456', brandName: 'Café', whiteLabel: null };
      },
    },
  };
  return new BrandIconService({} as never, prisma);
}

async function logoPng(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 4, background: '#0a0' } }).png().toBuffer();
}

describe('BrandIconService', () => {
  it('la descarga del logo lleva tiempo máximo', async () => {
    const buf = await logoPng();
    const fetch = vi.fn(async (_u: string, _i?: RequestInit) => new Response(new Uint8Array(buf), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await montar('https://pub-x.r2.dev/logo-timeout.png').generate({ tenantSlug: 'cafe', size: 64, purpose: 'any' });
    expect(fetch).toHaveBeenCalled();
    expect(fetch.mock.calls[0][1]?.signal).toBeDefined();
  });

  it('un logo que dice pesar cientos de megas no se descarga: sale la inicial', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('x', { status: 200, headers: { 'content-length': String(500 * 1024 * 1024) } }),
    );
    vi.stubGlobal('fetch', fetch);
    const svc = montar('https://pub-x.r2.dev/logo-gigante.png');
    const leido = await (svc as any).fetchImage('https://pub-x.r2.dev/logo-gigante.png');
    expect(leido).toBeNull();
  });

  it('pedir el mismo icono dos veces no descarga ni procesa dos veces', async () => {
    const buf = await logoPng();
    const fetch = vi.fn(async () => new Response(new Uint8Array(buf), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const svc = montar('https://pub-x.r2.dev/logo-repetido.png');
    const a = await svc.generate({ tenantSlug: 'cafe', size: 180, purpose: 'apple' });
    const b = await svc.generate({ tenantSlug: 'cafe', size: 180, purpose: 'apple' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(b?.buffer.equals(a!.buffer)).toBe(true);
  });

  it('si el negocio cambia de logo, el icono cambia (la caché no lo tapa)', async () => {
    const buf = await logoPng();
    const fetch = vi.fn(async () => new Response(new Uint8Array(buf), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    let logo = 'https://pub-x.r2.dev/logo-viejo.png';
    const prisma: any = {
      tenant: {
        findUnique: async () => ({ logoUrl: logo, walletLogoUrl: null, primaryColor: '#123456', brandName: 'Café', whiteLabel: null }),
      },
    };
    const svc = new BrandIconService({} as never, prisma);
    await svc.generate({ tenantSlug: 'cafe', size: 96, purpose: 'any' });
    logo = 'https://pub-x.r2.dev/logo-nuevo.png';
    await svc.generate({ tenantSlug: 'cafe', size: 96, purpose: 'any' });
    expect(fetch.mock.calls.map((c: any[]) => c[0])).toEqual([
      'https://pub-x.r2.dev/logo-viejo.png',
      'https://pub-x.r2.dev/logo-nuevo.png',
    ]);
  });
});
