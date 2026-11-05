import { describe, expect, it } from 'vitest';
import { sellosDeBienvenida } from './sellos-de-bienvenida';

const sellos = (welcomeStamps: number, stampsRequired = 10) => ({
  type: 'STAMPS',
  stampsRequired,
  welcomeStamps,
});

describe('sellosDeBienvenida', () => {
  it('sin nada configurado arranca vacío', () => {
    expect(sellosDeBienvenida(sellos(0))).toBe(0);
  });

  it('usa los sellos al instalar de la tarjeta', () => {
    expect(sellosDeBienvenida(sellos(2))).toBe(2);
  });

  it('el enlace de campaña manda sobre la tarjeta', () => {
    expect(sellosDeBienvenida(sellos(1), 3)).toBe(3);
  });

  it('un enlace sin sellos deja los de la tarjeta', () => {
    expect(sellosDeBienvenida(sellos(2), 0)).toBe(2);
  });

  it('nunca nace con el cartón lleno', () => {
    expect(sellosDeBienvenida(sellos(10))).toBe(9);
    expect(sellosDeBienvenida(sellos(1), 25)).toBe(9);
  });

  it('en una de visitas el tope es visitsRequired', () => {
    expect(
      sellosDeBienvenida({ type: 'VISITS', visitsRequired: 5, stampsRequired: 10, welcomeStamps: 8 }),
    ).toBe(4);
  });

  it('una tarjeta sin cartón ignora el de la tarjeta y respeta el del enlace', () => {
    expect(sellosDeBienvenida({ type: 'POINTS', stampsRequired: null, welcomeStamps: 3 })).toBe(0);
    expect(sellosDeBienvenida({ type: 'POINTS', stampsRequired: null, welcomeStamps: 3 }, 2)).toBe(2);
  });

  it('valores raros no rompen', () => {
    expect(sellosDeBienvenida({ type: 'STAMPS', stampsRequired: 10, welcomeStamps: null })).toBe(0);
    expect(sellosDeBienvenida(sellos(-4))).toBe(0);
    expect(sellosDeBienvenida(sellos(2.7))).toBe(2);
  });
});
