import { describe, expect, it } from 'vitest';
import { esPruebaGratisHotmart } from './prueba-gratis-hotmart';

const compra = (purchase: Record<string, unknown>) => ({ data: { purchase } });

describe('esPruebaGratisHotmart', () => {
  it('la prueba real de Licorera 27° (precio 0, recurrencia 1) es prueba', () => {
    expect(
      esPruebaGratisHotmart(
        compra({
          price: { value: 0, currency_value: 'COP' },
          full_price: { value: 0, currency_value: 'COP' },
          recurrence_number: 1,
        }),
      ),
    ).toBe(true);
  });

  it('un cobro con precio NO es prueba', () => {
    expect(esPruebaGratisHotmart(compra({ price: { value: 272000, currency_value: 'COP' }, recurrence_number: 1 }))).toBe(false);
  });

  it('un evento sin precio NO es prueba (hay cobros reales sin price)', () => {
    expect(esPruebaGratisHotmart(compra({ recurrence_number: 1 }))).toBe(false);
    expect(esPruebaGratisHotmart({})).toBe(false);
    expect(esPruebaGratisHotmart(null)).toBe(false);
  });

  it('precio 0 con precio lleno distinto de 0 no se toma como prueba', () => {
    expect(esPruebaGratisHotmart(compra({ price: { value: 0 }, full_price: { value: 68 } }))).toBe(false);
  });

  it('una recurrencia 2+ a 0 no es la prueba', () => {
    expect(esPruebaGratisHotmart(compra({ price: { value: 0 }, recurrence_number: 2 }))).toBe(false);
  });

  it('acepta el 0 como texto', () => {
    expect(esPruebaGratisHotmart(compra({ price: { value: '0' } }))).toBe(true);
  });
});
