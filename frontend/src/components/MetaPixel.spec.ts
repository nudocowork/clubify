import { describe, it, expect } from 'vitest';
import { codigoBaseDelPixel, pixelIdValido } from './MetaPixel';

/**
 * El píxel de Meta.
 *
 * Lo que se prueba aquí es lo que nadie notaría si se rompe: un id mal
 * validado que se cuela, o un script que sale con el id de otra marca. El
 * daño no se ve en la pantalla — se ve semanas después, en la cuenta
 * publicitaria equivocada.
 */

describe('qué se acepta como id de píxel', () => {
  it('el de Sellea, tal cual lo mandó Humberto', () => {
    expect(pixelIdValido('1393034506278228')).toBe('1393034506278228');
  });

  it('con espacios de un copiar y pegar, se limpia', () => {
    expect(pixelIdValido('  1393034506278228 ')).toBe('1393034506278228');
  });

  it('sin marca no hay píxel', () => {
    expect(pixelIdValido(null)).toBeNull();
    expect(pixelIdValido(undefined)).toBeNull();
    expect(pixelIdValido('')).toBeNull();
    expect(pixelIdValido('   ')).toBeNull();
  });

  it('lo que no es un id NO se pinta', () => {
    // Si alguien pega el script entero en el campo, esto acabaría dentro de un
    // <script> del head. Solo dígitos.
    expect(pixelIdValido("fbq('init','123')")).toBeNull();
    expect(pixelIdValido('GTM-ABC123')).toBeNull();
    expect(pixelIdValido('G-XXXXXXX')).toBeNull();
    expect(pixelIdValido('123')).toBeNull(); // demasiado corto para ser real
  });

  it('un intento de inyección se descarta entero', () => {
    expect(pixelIdValido("1393034506278228'); alert(1); //")).toBeNull();
    expect(pixelIdValido('</script><script>alert(1)</script>')).toBeNull();
  });
});

describe('el script base', () => {
  const codigo = codigoBaseDelPixel('1393034506278228');

  it('inicializa y manda el PageView de la carga, una sola vez', () => {
    expect(codigo).toContain("fbq('init', '1393034506278228')");
    expect(codigo.match(/fbq\('init'/g)).toHaveLength(1);
    expect(codigo.match(/fbq\('track', 'PageView'\)/g)).toHaveLength(1);
  });

  it('lleva el id de la marca y NINGÚN otro', () => {
    // La prueba de que no queda un id de ejemplo pegado de una copia.
    const ids = codigo.match(/\d{6,20}/g) ?? [];
    expect([...new Set(ids)]).toEqual(['1393034506278228']);
  });

  it('apunta al script de Meta y no a otra parte', () => {
    expect(codigo).toContain('https://connect.facebook.net/en_US/fbevents.js');
  });

  it('cada marca recibe el suyo', () => {
    expect(codigoBaseDelPixel('999888777666555')).toContain('999888777666555');
    expect(codigoBaseDelPixel('999888777666555')).not.toContain('1393034506278228');
  });
});
