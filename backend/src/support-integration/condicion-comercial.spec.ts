import { describe, expect, it } from 'vitest';
import { condicionComercial } from './support-integration.service';

// Team Soporte muestra cortesías, pruebas y marcas blancas con su condición: no
// pueden quedar como clientes de pago ordinarios.
describe('condicionComercial', () => {
  it.each([
    [null, 'SIN_COBRO'],
    ['', 'SIN_COBRO'],
    ['trial-abc', 'TRIAL'],
    ['comp-123', 'CORTESIA'],
    ['campaign-x', 'SISTEMA'],
    ['sim-1', 'SISTEMA'],
    ['manual-2026', 'MANUAL'],
    ['wl-99', 'MARCA_BLANCA'],
    ['A1B2C3', 'HOTMART'],
  ])('%s → %s', (code, esperado) => {
    expect(condicionComercial(code)).toBe(esperado);
  });
});
