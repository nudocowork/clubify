import { describe, expect, it } from 'vitest';
import { esComisionDePagoManual } from './comision-de-pago-manual';

// La etiqueta «Pago manual» de la lista de comisiones (Javier, 2026-10-01).
// Caso real: La Burguesía, Plan Trimestral, cobrada por Nequi y registrada a
// mano; su comisión nace sin transacción de Hotmart.

const d = (iso: string) => new Date(iso);

describe('¿la comisión salió de un pago manual?', () => {
  it('sin transacción y el mismo día de un pago manual: sí', () => {
    expect(
      esComisionDePagoManual(d('2026-09-16T17:00:00Z'), null, [d('2026-09-16T12:00:00Z')]),
    ).toBe(true);
  });

  it('a pocos días del pago (zona horaria, fecha capturada a mano): sí', () => {
    expect(
      esComisionDePagoManual(d('2026-09-18T17:00:00Z'), null, [d('2026-09-16T12:00:00Z')]),
    ).toBe(true);
  });

  it('con transacción de Hotmart: no, aunque el negocio tenga pagos manuales ese día', () => {
    expect(
      esComisionDePagoManual(d('2026-09-16T17:00:00Z'), 'HP123', [d('2026-09-16T12:00:00Z')]),
    ).toBe(false);
  });

  it('sin transacción pero lejos de cualquier pago manual: no', () => {
    // Un negocio que pagó por fuera en junio y ahora renovó por la pasarela
    // con un aviso que no trajo transacción.
    expect(
      esComisionDePagoManual(d('2026-09-16T17:00:00Z'), null, [d('2026-06-16T12:00:00Z')]),
    ).toBe(false);
  });

  it('negocio sin pagos manuales: no', () => {
    expect(esComisionDePagoManual(d('2026-09-16T17:00:00Z'), null, [])).toBe(false);
  });
});
