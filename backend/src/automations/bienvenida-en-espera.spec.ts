import { describe, expect, it } from 'vitest';
import { paseListoParaBienvenida } from './bienvenida-en-espera';

const ahora = new Date('2026-11-16T12:00:00Z');
const hace = (s: number) => new Date(ahora.getTime() - s * 1000);

describe('la bienvenida espera a que la tarjeta esté en el Wallet', () => {
  it('pase recién creado, sin instalar: todavía no (Burrata)', () => {
    expect(paseListoParaBienvenida({ walletPlatform: null, walletInstalledAt: null, dispositivosApple: 0 }, ahora)).toBe(false);
  });

  it('iPhone: en cuanto Apple registra el dispositivo', () => {
    expect(paseListoParaBienvenida({ walletPlatform: 'APPLE', walletInstalledAt: hace(5), dispositivosApple: 1 }, ahora)).toBe(true);
  });

  it('iPhone que descargó el .pkpass pero no lo agregó: todavía no', () => {
    expect(paseListoParaBienvenida({ walletPlatform: 'APPLE', walletInstalledAt: hace(600), dispositivosApple: 0 }, ahora)).toBe(false);
  });

  it('Google: espera un minuto desde que pulsó guardar', () => {
    expect(paseListoParaBienvenida({ walletPlatform: 'GOOGLE', walletInstalledAt: hace(20), dispositivosApple: 0 }, ahora)).toBe(false);
    expect(paseListoParaBienvenida({ walletPlatform: 'GOOGLE', walletInstalledAt: hace(61), dispositivosApple: 0 }, ahora)).toBe(true);
  });
});
