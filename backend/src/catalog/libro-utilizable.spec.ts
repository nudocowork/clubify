import { describe, it, expect } from 'vitest';
import { libroUtilizable } from './libro-utilizable';

describe('libroUtilizable', () => {
  it('apagado: nunca', () => {
    expect(libroUtilizable({ bookMenuEnabled: false, tienePaginas: true, digitalMenuEnabled: true })).toBe(false);
  });
  it('encendido con páginas: sí', () => {
    expect(libroUtilizable({ bookMenuEnabled: true, tienePaginas: true, digitalMenuEnabled: true })).toBe(true);
  });
  it('encendido sin páginas y con carta digital: NO (se enseña la carta)', () => {
    expect(libroUtilizable({ bookMenuEnabled: true, tienePaginas: false, digitalMenuEnabled: true })).toBe(false);
  });
  it('encendido sin páginas y sin carta digital: sí (no hay nada mejor)', () => {
    expect(libroUtilizable({ bookMenuEnabled: true, tienePaginas: false, digitalMenuEnabled: false })).toBe(true);
  });
});
