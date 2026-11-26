import { describe, expect, it } from 'vitest';
import { nivelMostrado } from './nivel-mostrado';

const tiers = [
  { name: 'Plata', threshold: 300000 },
  { name: 'Bronce', threshold: 0 },
];

describe('nivelMostrado', () => {
  it('el nivel guardado manda', () => {
    expect(nivelMostrado('Plata', tiers)).toBe('Plata');
  });
  it('sin nivel todavía, el que empieza en $0', () => {
    expect(nivelMostrado(null, tiers)).toBe('Bronce');
  });
  it('sin nivel de entrada ni niveles, nada (el pase dice «Miembro»)', () => {
    expect(nivelMostrado(null, [{ name: 'Oro', threshold: 600000 }])).toBeNull();
    expect(nivelMostrado(null, null)).toBeNull();
  });
});
