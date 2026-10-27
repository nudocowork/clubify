import { describe, it, expect } from 'vitest';
import { telefonoConIndicativo } from './telefono-con-indicativo';

describe('telefonoConIndicativo', () => {
  it('La Burguesía: «3225998240» de Colombia es +57, no Bélgica', () => {
    expect(telefonoConIndicativo('3225998240', 'CO')).toBe('+573225998240');
  });
  it('con «+» se respeta y se limpia', () => {
    expect(telefonoConIndicativo('+57 322 599 8240', 'CO')).toBe('+573225998240');
    expect(telefonoConIndicativo('+507 6679-3699', 'CO')).toBe('+50766793699');
  });
  it('«00» es lo mismo que «+»', () => {
    expect(telefonoConIndicativo('0057 3225998240', 'CO')).toBe('+573225998240');
  });
  it('número nacional de otros países', () => {
    expect(telefonoConIndicativo('66793699', 'PA')).toBe('+50766793699');
    expect(telefonoConIndicativo('5512345678', 'MX')).toBe('+525512345678');
  });
  it('más de 10 cifras sin «+»: el indicativo ya va dentro', () => {
    expect(telefonoConIndicativo('573225998240', 'CO')).toBe('+573225998240');
  });
  it('sin país conocido no adivina; vacío es null', () => {
    expect(telefonoConIndicativo('3225998240', null)).toBe('3225998240');
    expect(telefonoConIndicativo('  ', 'CO')).toBeNull();
    expect(telefonoConIndicativo(null, 'CO')).toBeNull();
  });
});
