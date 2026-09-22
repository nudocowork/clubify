import { describe, it, expect } from 'vitest';
import { leerAvisosAlEquipo, validarAvisosAlEquipo } from './avisos-al-equipo';

/**
 * «Avisos al equipo» (Integraciones SMS): quién recibe qué SMS interno. Antes
 * solo se cambiaba a mano en la base; ahora lo edita la plataforma. Lo que no
 * se puede colar: una lista vacía (el servicio la leería como «teléfonos de
 * fábrica» y mandaría todo a Javier y Jhon), teléfonos sin código de país y
 * tipos de aviso que no existen.
 */
describe('validarAvisosAlEquipo', () => {
  it('acepta y normaliza (espacios y guiones fuera)', () => {
    const r = validarAvisosAlEquipo([
      { name: ' Samuel ', phone: '+57 315 439-1993', solo: ['implementacion', 'preregistro', 'implementacion'] },
      { name: 'Javier', phone: '+573248088401' },
    ]);
    expect(r).toEqual({
      ok: true,
      personas: [
        { name: 'Samuel', phone: '+573154391993', solo: ['implementacion', 'preregistro'] },
        { name: 'Javier', phone: '+573248088401' },
      ],
    });
  });

  it('rechaza la lista vacía', () => {
    const r = validarAvisosAlEquipo([]);
    expect(r.ok).toBe(false);
  });

  it('rechaza un teléfono sin código de país', () => {
    const r = validarAvisosAlEquipo([{ name: 'Samuel', phone: '3154391993' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('código de país');
  });

  it('rechaza teléfonos repetidos', () => {
    const r = validarAvisosAlEquipo([
      { name: 'A', phone: '+573001112233' },
      { name: 'B', phone: '+57 300 111 2233' },
    ]);
    expect(r.ok).toBe(false);
  });

  it('rechaza un tipo de aviso inventado', () => {
    const r = validarAvisosAlEquipo([{ name: 'A', phone: '+573001112233', solo: ['todo'] }]);
    expect(r.ok).toBe(false);
  });

  it('«solo» vacío no significa «nada»: se rechaza', () => {
    const r = validarAvisosAlEquipo([{ name: 'A', phone: '+573001112233', solo: [] }]);
    expect(r.ok).toBe(false);
  });
});

describe('leerAvisosAlEquipo', () => {
  it('lee lo que hay hoy en producción', () => {
    const hoy =
      '[{"name":"Javier","phone":"+573248088401"},{"name":"Jhon","phone":"+573181666999","solo":["pago_sin_cuenta","preregistro"]},{"name":"Samuel","phone":"+573154391993","solo":["preregistro"]}]';
    expect(leerAvisosAlEquipo(hoy)).toHaveLength(3);
  });
  it('no revienta con basura', () => {
    expect(leerAvisosAlEquipo('no es json')).toEqual([]);
    expect(leerAvisosAlEquipo(null)).toEqual([]);
  });
});
