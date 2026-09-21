import { describe, it, expect } from 'vitest';
import { enlaceDeRecuperacion } from './enlace-de-recuperacion';

describe('el enlace de recuperar contraseña', () => {
  it('va al panel de la marca del usuario', () => {
    expect(enlaceDeRecuperacion('https://app.selleala.com', 'abc123')).toBe(
      'https://app.selleala.com/reset/abc123',
    );
  });

  it('no repite la barra final', () => {
    expect(enlaceDeRecuperacion('https://app.fideliso.com/', 'xyz')).toBe(
      'https://app.fideliso.com/reset/xyz',
    );
  });

  it('sin panel NO hay enlace: el llamador no envía', () => {
    // Una marca blanca sin dominio propio. Mandarle `soyclubify.com` a su
    // usuario sería contarle que su proveedor corre sobre Clubify.
    expect(enlaceDeRecuperacion('', 'abc')).toBe('');
    expect(enlaceDeRecuperacion(null, 'abc')).toBe('');
    expect(enlaceDeRecuperacion(undefined, 'abc')).toBe('');
  });

  it('sin token tampoco: un enlace a /reset/ vacío no sirve de nada', () => {
    expect(enlaceDeRecuperacion('https://app.soyclubify.com', '')).toBe('');
  });

  it('exige http(s): un dominio suelto no es un enlace', () => {
    expect(enlaceDeRecuperacion('app.selleala.com', 'abc')).toBe('');
  });

  it('escapa el token, que va en la URL', () => {
    expect(enlaceDeRecuperacion('https://app.soyclubify.com', 'a b/c')).toBe(
      'https://app.soyclubify.com/reset/a%20b%2Fc',
    );
  });
});
