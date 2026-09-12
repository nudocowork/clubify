import { describe, it, expect } from 'vitest';
import { localeDelPase, passLabels } from './pass-labels';

/**
 * En qué idioma sale un pase.
 *
 * EL FALLO (2026-09-11, Javier): «a JEANK se le dio traducir a inglés, ya que
 * es un negocio de Estados Unidos, sin embargo el sistema no hizo la
 * traducción total de su negocio».
 *
 * `Tenant.locale` estaba en `en-US` y no lo miraba nadie: los rótulos del pase
 * salían del idioma del CLIENTE, que solo se rellena si él lo elige al
 * enrolarse. Sin eso, español — así que un negocio en inglés repartía tarjetas
 * que decían «SELLOS» y «CLIENTE».
 */
describe('idioma del pase', () => {
  it('manda el del cliente cuando lo tiene', () => {
    expect(
      localeDelPase({ customer: { locale: 'es' }, tenant: { locale: 'en-US' } }),
    ).toBe('es');
  });

  it('si el cliente no eligió, el del negocio — el caso de JEANK', () => {
    expect(
      localeDelPase({ customer: { locale: null }, tenant: { locale: 'en-US' } }),
    ).toBe('en');
  });

  it('sin cliente cargado tampoco se pierde el del negocio', () => {
    expect(localeDelPase({ tenant: { locale: 'en-US' } })).toBe('en');
  });

  it('sin ninguno de los dos sigue siendo español', () => {
    // Los 121 negocios en español no cambian de comportamiento.
    expect(localeDelPase({ customer: null, tenant: { locale: null } })).toBe('es');
    expect(localeDelPase({})).toBe('es');
    expect(localeDelPase()).toBe('es');
  });

  it('las variantes regionales caen a su base', () => {
    expect(localeDelPase({ tenant: { locale: 'en-GB' } })).toBe('en');
    expect(localeDelPase({ tenant: { locale: 'pt-BR' } })).toBe('pt');
  });

  it('y los rótulos salen de verdad en inglés', () => {
    // Que resuelva 'en' no sirve de nada si el pase sigue diciendo SELLOS.
    const L = passLabels(localeDelPase({ tenant: { locale: 'en-US' } }));
    const es = passLabels('es');
    expect(L.stamps).not.toBe(es.stamps);
    expect(L.stamps.toLowerCase()).toContain('stamp');
  });
});
