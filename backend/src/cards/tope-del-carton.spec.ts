import { describe, it, expect } from 'vitest';
import {
  TOPE_POR_DEFECTO,
  conTopeNormalizado,
  motivoParaRechazarElTope,
} from './tope-del-carton';

/**
 * Un cartón de sellos SIN tope configurado.
 *
 * El caso real (producción, 2026-09-26): «Descomunal - Cocina y SportBar»
 * reparte una tarjeta por «Desgranado de Pollo + Gaseosa» con 59 pases y 54
 * instalados. Sus clientes ven «8/10» —un 10 que el negocio no eligió— y el
 * pase no puede llegar a COMPLETED nunca, así que nadie reclama el pollo.
 */

describe('la puerta del panel: rechaza', () => {
  it('una tarjeta de sellos SIN tope no se guarda', () => {
    expect(motivoParaRechazarElTope('STAMPS', null)).toMatch(/cuántos sellos/);
    expect(motivoParaRechazarElTope('VISITS', null)).toMatch(/cuántas visitas/);
  });

  it('y el motivo se lo lee el NEGOCIO: dice qué le pasa a su cliente', () => {
    const m = motivoParaRechazarElTope('STAMPS', null)!;
    expect(m).toMatch(/nunca pueden completar/);
    expect(m).not.toMatch(/null|stampsRequired|undefined/);
  });

  it('con tope pasa, incluido el 1', () => {
    expect(motivoParaRechazarElTope('STAMPS', 10)).toBeNull();
    expect(motivoParaRechazarElTope('STAMPS', 1)).toBeNull();
  });

  it('NO TOCAR ≠ QUITAR: una edición que no manda el campo no se rechaza', () => {
    // El formulario del diseño guarda solo colores. Sin esta distinción,
    // cambiar el color de una tarjeta vieja sin tope sería imposible.
    expect(motivoParaRechazarElTope('STAMPS', undefined)).toBeNull();
  });

  it('a un cupón o a una credencial no se les pide tope', () => {
    expect(motivoParaRechazarElTope('COUPON', null)).toBeNull();
    expect(motivoParaRechazarElTope('INFO', null)).toBeNull();
  });
});

describe('la puerta del Onboarding: rellena y avisa', () => {
  it('rellena con 10, que es LO QUE EL PASE YA ENSEÑA', () => {
    const r = conTopeNormalizado('STAMPS', { name: 'Tarjeta de sellos' });
    expect(r.datos.stampsRequired).toBe(TOPE_POR_DEFECTO);
    expect(TOPE_POR_DEFECTO).toBe(10);
    // Se devuelve qué se rellenó para poder dejarlo en el log: si se rellena
    // en silencio, nadie se entera de que el Onboarding dejó de mandarlo.
    expect(r.rellenado).toBe('stampsRequired');
  });

  it('NO pisa el tope que sí vino', () => {
    const r = conTopeNormalizado('STAMPS', { stampsRequired: 6 });
    expect(r.datos.stampsRequired).toBe(6);
    expect(r.rellenado).toBeNull();
  });

  it('un tope de 0 es un valor, no un hueco', () => {
    const r = conTopeNormalizado('STAMPS', { stampsRequired: 0 });
    expect(r.datos.stampsRequired).toBe(0);
    expect(r.rellenado).toBeNull();
  });

  it('a un cupón no le inventa nada', () => {
    const r = conTopeNormalizado('COUPON', { name: 'Bienvenida' });
    expect(r.datos).not.toHaveProperty('stampsRequired');
    expect(r.rellenado).toBeNull();
  });
});
