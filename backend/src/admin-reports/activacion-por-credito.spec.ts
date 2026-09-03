import { describe, it, expect } from 'vitest';

/**
 * Cuánto tiempo se le da a un negocio al activarlo con un crédito.
 *
 * El fallo (26-08-2026): dos negocios de Sellea creados con seis minutos de
 * diferencia, los dos mensuales, y a uno le quedó el vencimiento un mes más
 * tarde que al otro.
 *
 *   Beauty By Mir   creado 23:57  →  vence 26-sep   ✅
 *   Divine Medical  creado 23:51  →  vence 26-oct   ❌ un mes de regalo
 *
 * La base del cálculo se tomaba del vencimiento existente siempre que fuera
 * futuro, sin mirar el estado del negocio. Eso está bien en una RENOVACIÓN
 * —no se le quitan los días que le quedaban— pero un negocio SUSPENDIDO puede
 * arrastrar un vencimiento de un intento anterior que quedó a medias, y ahí
 * extender es regalar.
 */

type Negocio = {
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  currentPeriodEnd: Date | null;
};

/** Espejo del cálculo de `activateTenant`. */
function baseDelPeriodo(t: Negocio, now: Date): Date {
  const esRenovacion = t.status === 'ACTIVE';
  return esRenovacion && t.currentPeriodEnd && t.currentPeriodEnd > now
    ? t.currentPeriodEnd
    : now;
}

const AHORA = new Date('2026-08-26T23:52:00Z');
const FUTURO = new Date('2026-09-26T23:51:00Z');
const PASADO = new Date('2026-07-26T00:00:00Z');

describe('primera activación: se cuenta desde hoy', () => {
  it('un negocio SUSPENDIDO arranca desde ahora, aunque arrastre un vencimiento futuro', () => {
    // Este es el caso Divine: un intento anterior le dejó el vencimiento
    // puesto sin haber consumido crédito.
    const t: Negocio = { status: 'SUSPENDED', currentPeriodEnd: FUTURO };
    expect(baseDelPeriodo(t, AHORA)).toBe(AHORA);
  });

  it('un negocio SUSPENDIDO sin vencimiento arranca desde ahora', () => {
    const t: Negocio = { status: 'SUSPENDED', currentPeriodEnd: null };
    expect(baseDelPeriodo(t, AHORA)).toBe(AHORA);
  });

  it('un negocio en prueba arranca desde ahora', () => {
    const t: Negocio = { status: 'TRIAL', currentPeriodEnd: FUTURO };
    expect(baseDelPeriodo(t, AHORA)).toBe(AHORA);
  });
});

describe('renovación: NO se le quitan los días que le quedaban', () => {
  it('un negocio ACTIVO extiende desde su vencimiento', () => {
    const t: Negocio = { status: 'ACTIVE', currentPeriodEnd: FUTURO };
    expect(baseDelPeriodo(t, AHORA)).toBe(FUTURO);
  });

  it('un negocio ACTIVO ya vencido arranca desde ahora, no desde el pasado', () => {
    // Si no, se le daría un mes que empezó hace semanas y vencería enseguida.
    const t: Negocio = { status: 'ACTIVE', currentPeriodEnd: PASADO };
    expect(baseDelPeriodo(t, AHORA)).toBe(AHORA);
  });

  it('un negocio ACTIVO sin vencimiento arranca desde ahora', () => {
    const t: Negocio = { status: 'ACTIVE', currentPeriodEnd: null };
    expect(baseDelPeriodo(t, AHORA)).toBe(AHORA);
  });
});

describe('los dos casos reales que lo destaparon', () => {
  it('Divine (suspendido con vencimiento arrastrado) ya NO regala el mes', () => {
    const divine: Negocio = {
      status: 'SUSPENDED',
      currentPeriodEnd: new Date('2026-09-26T23:51:26Z'),
    };
    const base = baseDelPeriodo(divine, AHORA);
    expect(base).toBe(AHORA);
    // Con la base correcta, +1 mes cae en septiembre, no en octubre.
    expect(base.getUTCMonth()).toBe(7); // agosto (0-indexado)
  });

  it('Beauty (suspendido y limpio) se comporta igual que antes', () => {
    const beauty: Negocio = { status: 'SUSPENDED', currentPeriodEnd: null };
    expect(baseDelPeriodo(beauty, AHORA)).toBe(AHORA);
  });
});
