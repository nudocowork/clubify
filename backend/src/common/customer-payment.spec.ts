import { describe, expect, it } from 'vitest';
import {
  customerPaymentLabel,
  normalizeAcceptedPaymentMethods,
} from './customer-payment';

describe('customerPaymentLabel', () => {
  it('humaniza los métodos conocidos (el dueño no debe leer el enum crudo)', () => {
    expect(customerPaymentLabel('EFECTIVO')).toBe('efectivo');
    expect(customerPaymentLabel('TARJETA')).toBe('tarjeta');
    expect(customerPaymentLabel('TRANSFERENCIA')).toBe('transferencia');
  });

  it('OTRO usa el texto libre del cliente y cae a «otro» si no lo escribió', () => {
    expect(customerPaymentLabel('OTRO', 'Nequi')).toBe('Nequi');
    expect(customerPaymentLabel('OTRO', '  ')).toBe('otro');
    expect(customerPaymentLabel('OTRO', null)).toBe('otro');
  });

  it('sin método devuelve vacío → el mensaje omite la línea', () => {
    expect(customerPaymentLabel(null)).toBe('');
    expect(customerPaymentLabel('  ')).toBe('');
    expect(customerPaymentLabel(undefined)).toBe('');
  });

  it('un valor desconocido (legacy) pasa tal cual, sin inventar', () => {
    expect(customerPaymentLabel('Datafono viejo')).toBe('Datafono viejo');
  });
});

describe('normalizeAcceptedPaymentMethods', () => {
  it('sin configurar (ausente, basura o vacío) → null = todos los métodos', () => {
    expect(normalizeAcceptedPaymentMethods(undefined)).toBeNull();
    expect(normalizeAcceptedPaymentMethods(null)).toBeNull();
    expect(normalizeAcceptedPaymentMethods('EFECTIVO')).toBeNull();
    expect(normalizeAcceptedPaymentMethods([])).toBeNull();
    // Solo valores inválidos = como si no hubiera nada configurado.
    expect(normalizeAcceptedPaymentMethods(['BITCOIN', 42])).toBeNull();
  });

  it('filtra inválidos, dedupe y devuelve orden canónico', () => {
    expect(
      normalizeAcceptedPaymentMethods([
        'TRANSFERENCIA',
        'EFECTIVO',
        'EFECTIVO',
        'BITCOIN',
      ]),
    ).toEqual(['EFECTIVO', 'TRANSFERENCIA']);
  });
});
