import { describe, it, expect } from 'vitest';
import { enlaceDeLaLista, enlaceDelInfolink, hostPublico, ordenarNegocios } from './enlaces';

describe('Biblioteca de Infolinks · enlaces', () => {
  it('sin dominios, soyclubify.com', () => {
    expect(hostPublico({})).toBe('soyclubify.com');
  });

  it('el dominio propio del negocio gana a los de la marca', () => {
    expect(
      hostPublico({ dominioPropio: 'menu.lagloriosa.co', dominioAppMarca: 'app.sellea.com', dominioMarca: 'sellea.com' }),
    ).toBe('menu.lagloriosa.co');
  });

  it('un negocio de otra marca nunca recibe un enlace de soyclubify.com', () => {
    expect(hostPublico({ dominioAppMarca: 'https://app.sellea.com/' })).toBe('app.sellea.com');
    expect(hostPublico({ dominioMarca: 'sellea.com' })).toBe('sellea.com');
  });

  it('con enlace corto, en la raíz; sin él, bajo /i/<negocio>/<infolink>', () => {
    expect(enlaceDelInfolink('soyclubify.com', 'la-gloriosa', { slug: 'infolink2', rootSlug: 'cabecera' })).toBe(
      'https://soyclubify.com/cabecera',
    );
    expect(enlaceDelInfolink('soyclubify.com', 'la-gloriosa', { slug: 'infolink2', rootSlug: null })).toBe(
      'https://soyclubify.com/i/la-gloriosa/infolink2',
    );
    expect(enlaceDeLaLista('soyclubify.com', 'la-gloriosa')).toBe('https://soyclubify.com/i/la-gloriosa');
  });

  it('primero los que tienen algún InfoLink activo, luego por nombre', () => {
    const r = ordenarNegocios([
      { nombre: 'Zeta', activos: 1 },
      { nombre: 'alfa', activos: 0 },
      { nombre: 'Beta', activos: 2 },
    ]);
    expect(r.map((x) => x.nombre)).toEqual(['Beta', 'Zeta', 'alfa']);
  });
});
