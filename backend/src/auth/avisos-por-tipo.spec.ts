import { describe, it, expect } from 'vitest';
import type { TipoAviso } from './prereg-alerts.service';

/**
 * Quién recibe cada aviso del equipo.
 *
 * Una compra dispara TRES avisos seguidos —«Pago recibido sin cuenta»,
 * «Nueva compra» y «Nuevo preregistro»— y todos iban a todo el mundo. Jhon
 * pidió quedarse solo con el primero y el tercero (31-08-2026).
 *
 * La regla que sostiene esto: **sin `solo` se recibe todo**. Así, cuando
 * alguien añada un aviso nuevo, nadie deja de recibirlo por olvido — la
 * restricción tiene que escribirse a propósito.
 */

type Destinatario = { name: string; phone: string; solo?: TipoAviso[] };

/** Espejo de `resolvePhones(tipo)`. */
function destinatariosDe(
  todos: Destinatario[],
  tipo?: TipoAviso,
): Destinatario[] {
  if (!tipo) return todos;
  return todos.filter((p) => !p.solo?.length || p.solo.includes(tipo));
}

const JAVIER: Destinatario = { name: 'Javier', phone: '+573248088401' };
const JHON: Destinatario = {
  name: 'Jhon',
  phone: '+573181666999',
  solo: ['pago_sin_cuenta', 'preregistro'],
};
const EQUIPO = [JAVIER, JHON];

const recibe = (tipo: TipoAviso, quien: Destinatario) =>
  destinatariosDe(EQUIPO, tipo).some((p) => p.phone === quien.phone);

describe('Jhon recibe el del pago y el del preregistro, no el de la compra', () => {
  it('«Pago recibido sin cuenta» sí le llega', () => {
    expect(recibe('pago_sin_cuenta', JHON)).toBe(true);
  });

  it('«Nuevo preregistro» sí le llega', () => {
    expect(recibe('preregistro', JHON)).toBe(true);
  });

  it('«Nueva compra» NO le llega — es el que pidió quitar', () => {
    expect(recibe('nueva_compra', JHON)).toBe(false);
  });

  it('los avisos que no pidió tampoco le llegan', () => {
    expect(recibe('trial', JHON)).toBe(false);
    expect(recibe('lab', JHON)).toBe(false);
  });
});

describe('quien no restringe nada lo sigue recibiendo todo', () => {
  it('a Javier le llegan los cinco tipos', () => {
    const tipos: TipoAviso[] = [
      'pago_sin_cuenta',
      'nueva_compra',
      'preregistro',
      'trial',
      'lab',
    ];
    for (const t of tipos) expect(recibe(t, JAVIER)).toBe(true);
  });

  it('una lista `solo` vacía se trata como «todo», no como «nada»', () => {
    // Un array vacío guardado por error en el Setting dejaría a esa persona
    // sin ningún aviso y sin que nadie lo note. Se lee como sin restricción.
    const raro: Destinatario = { name: 'X', phone: '+1', solo: [] };
    expect(destinatariosDe([raro], 'nueva_compra')).toHaveLength(1);
  });
});

describe('un aviso sin tipo va a todo el mundo', () => {
  it('nadie se queda fuera por un tipo que no se declaró', () => {
    // Es el caso de un aviso nuevo que alguien añade sin etiquetar: mejor que
    // llegue de más a que se pierda en silencio.
    expect(destinatariosDe(EQUIPO, undefined)).toHaveLength(2);
  });
});
