import { describe, it, expect } from 'vitest';
import { telefonoDeAviso } from './telefono-de-aviso';

describe('telefonoDeAviso', () => {
  it('respeta los números que ya traen prefijo, con o sin espacios', () => {
    expect(telefonoDeAviso('+573001110001')).toBe('+573001110001');
    expect(telefonoDeAviso('+57 3001110001')).toBe('+573001110001');
    expect(telefonoDeAviso('+584240001111')).toBe('+584240001111');
    expect(telefonoDeAviso('+1 7860001111')).toBe('+17860001111');
    expect(telefonoDeAviso('+593 99000111')).toBe('+59399000111');
  });

  it('completa con +57 un celular colombiano escrito sin prefijo', () => {
    expect(telefonoDeAviso('3001110001')).toBe('+573001110001');
    expect(telefonoDeAviso('573001110001')).toBe('+573001110001');
  });

  it('no adivina: un celular con un dígito de más es inválido', () => {
    // El normalizador del comprador de Hotmart lo convertía en «+3…»: otro país.
    expect(telefonoDeAviso('30011100019')).toBeNull();
    expect(telefonoDeAviso('+5730011100019')).toBeNull();
  });

  it('vacío o basura no es un número', () => {
    expect(telefonoDeAviso('')).toBeNull();
    expect(telefonoDeAviso(null)).toBeNull();
    expect(telefonoDeAviso('sin whatsapp')).toBeNull();
    expect(telefonoDeAviso('12345')).toBeNull();
  });
});
