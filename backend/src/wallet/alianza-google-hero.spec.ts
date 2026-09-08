import { describe, it, expect } from 'vitest';
import { GoogleWalletService } from './google-wallet.service';

/**
 * La tarjeta de alianza no se podía añadir a Google Wallet desde Android.
 *
 * El JWT que se le manda a Google llevaba el módulo de imagen `hero`, cuya URL
 * devuelve 404 para las alianzas —`generatePassHeroImage` retorna null a
 * propósito y el controlador lo convierte en 404—. Google descarga las
 * imágenes AL GUARDAR: se encontraba el 404 y abortaba el guardado entero.
 *
 * Apple nunca se enteró porque no descarga nada: dibuja su propia franja del
 * aliado en proceso. De ahí el «en iPhone sí y en Android no», que es la
 * forma en que este fallo se reporta y la que despista.
 *
 * Comprobado en producción el 2026-09-08, antes del arreglo:
 *   hero.png  → 404 en el pase de alianza · 200 en uno normal
 *   strip.png → 200 en los dos
 */

/** Un pase mínimo: `buildObject` recibe `any` y solo mira lo que usa. */
function pase(opts: { convenioId?: string | null } = {}) {
  return {
    id: 'p1',
    serialNumber: 'CLB-TEST',
    qrToken: 'QR-TEST',
    stampsCount: 0,
    pointsBalance: 0,
    lastActivityAt: new Date('2026-09-08T00:00:00Z'),
    customer: { id: 'c1', fullName: 'Diego Berdiales' },
    tenant: { id: 't1', brandName: 'ALTIERI', locations: [] },
    card: {
      id: 'card1',
      type: 'STAMPS',
      name: 'Convenio',
      stampsRequired: 1,
      convenioId: opts.convenioId ?? null,
      design: {},
    },
  } as any;
}

function modulos(p: any): string[] {
  const svc = new GoogleWalletService(null as any, null as any);
  const obj = (svc as any).buildObject(p, 'clase', 'objeto');
  return (obj.imageModulesData ?? []).map((m: any) => m.id);
}

describe('tarjeta de alianza en Google Wallet', () => {
  it('NO lleva el módulo hero: su URL da 404 y Google aborta el guardado', () => {
    expect(modulos(pase({ convenioId: 'conv1' }))).not.toContain('hero');
  });

  it('sí lleva el strip: para alianzas da 200 y es el logo del aliado', () => {
    expect(modulos(pase({ convenioId: 'conv1' }))).toContain('strip');
  });

  it('una tarjeta normal conserva su hero, que sí existe', () => {
    const m = modulos(pase());
    expect(m).toContain('hero');
    expect(m).toContain('strip');
  });

  it('ninguna imagen del pase de alianza apunta a hero.png', () => {
    const svc = new GoogleWalletService(null as any, null as any);
    const obj = (svc as any).buildObject(pase({ convenioId: 'conv1' }), 'c', 'o');
    const uris = (obj.imageModulesData ?? []).map(
      (m: any) => m.mainImage.sourceUri.uri as string,
    );
    expect(uris.some((u: string) => u.includes('/hero.png'))).toBe(false);
  });
});
