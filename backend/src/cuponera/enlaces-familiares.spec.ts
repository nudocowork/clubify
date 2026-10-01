import { describe, expect, it } from 'vitest';
import { porQueNoSePuedeEnlazar } from './enlaces-familiares';

// Lo que protegen estas reglas es plata: un enlace indebido es una tarjeta
// gratis canjeando en los aliados. El endpoint público de Mi tarjeta y el
// panel usan EXACTAMENTE esta función.
describe('porQueNoSePuedeEnlazar', () => {
  const base = { titularEsEnlace: false, maxEnlaces: 3, enlacesActivos: 0, titularUsable: true };

  it('con cupo, titular al día y plan familiar → se puede', () => {
    expect(porQueNoSePuedeEnlazar(base)).toBeNull();
    expect(porQueNoSePuedeEnlazar({ ...base, enlacesActivos: 2 })).toBeNull();
  });

  it('un enlace no puede tener enlaces (no se encadenan)', () => {
    expect(porQueNoSePuedeEnlazar({ ...base, titularEsEnlace: true })).toMatch(/no se encadenan/);
  });

  it('un plan individual (0 enlaces) no enlaza a nadie', () => {
    expect(porQueNoSePuedeEnlazar({ ...base, maxEnlaces: 0 })).toMatch(/no incluye/);
  });

  it('con el titular vencido o de baja no se agregan familiares', () => {
    expect(porQueNoSePuedeEnlazar({ ...base, titularUsable: false })).toMatch(/no está al día/);
  });

  it('el cupo es cupo: con 3 de 3 no entra el cuarto', () => {
    expect(porQueNoSePuedeEnlazar({ ...base, enlacesActivos: 3 })).toMatch(/todas en uso/);
    // Y los cancelados liberan su lugar: 2 vivos de 3 → entra.
    expect(porQueNoSePuedeEnlazar({ ...base, enlacesActivos: 2 })).toBeNull();
  });

  it('el orden de los motivos: encadenar pesa más que el cupo', () => {
    expect(
      porQueNoSePuedeEnlazar({ titularEsEnlace: true, maxEnlaces: 0, enlacesActivos: 9, titularUsable: false }),
    ).toMatch(/no se encadenan/);
  });
});
