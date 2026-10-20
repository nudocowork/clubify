import { describe, it, expect } from 'vitest';
import { aplicarEstiloDelOnboarding } from './estilo-del-onboarding';

describe('estilo «libro» del Onboarding', () => {
  it('un diseño normal se aplica tal cual', () => {
    expect(aplicarEstiloDelOnboarding('GRID', 'CLASSIC')).toEqual({ menuLayout: 'GRID' });
  });
  it('«libro» enciende el Menú libro y NO escribe FLIPBOOK como diseño', () => {
    const r = aplicarEstiloDelOnboarding('FLIPBOOK', null);
    expect(r).toEqual({ bookMenuEnabled: true, menuLayout: 'CLASSIC' });
    expect(r.menuLayout).not.toBe('FLIPBOOK');
  });
  it('«libro» conserva el diseño que el negocio ya eligió en el panel', () => {
    expect(aplicarEstiloDelOnboarding('FLIPBOOK', 'SECTIONS')).toEqual({ bookMenuEnabled: true });
  });
  it('«libro» sobre un FLIPBOOK legado lo pasa a clásico', () => {
    expect(aplicarEstiloDelOnboarding('FLIPBOOK', 'FLIPBOOK')).toEqual({
      bookMenuEnabled: true,
      menuLayout: 'CLASSIC',
    });
  });
  it('sin estilo no toca nada', () => {
    expect(aplicarEstiloDelOnboarding(null, 'GRID')).toEqual({});
  });
});
