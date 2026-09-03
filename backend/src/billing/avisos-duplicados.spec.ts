import { describe, it, expect } from 'vitest';

/**
 * Un pago, un aviso.
 *
 * Una sola compra de suscripción en Stripe dispara TRES eventos que caen en el
 * mismo manejador, y llegan en el mismo segundo:
 *
 *   23:15:53  checkout.session.completed
 *   23:15:54  invoice.paid
 *   23:15:54  invoice.payment_succeeded
 *
 * La guarda contra duplicados leía `currentPeriodEnd`, decidía, y escribía
 * después. Los tres leían el valor viejo, los tres se creían los primeros, y el
 * negocio recibía el correo y el WhatsApp por duplicado (visto en producción el
 * 26-08-2026 con la compra de prueba de Sellea).
 *
 * Ahora el período se RECLAMA con un UPDATE condicional y solo uno se lo lleva.
 */

/** Simula la fila del negocio con la serialización que hace Postgres. */
class NegocioFalso {
  currentPeriodEnd: Date | null;
  constructor(inicial: Date | null = null) {
    this.currentPeriodEnd = inicial;
  }
  /** Espejo del `updateMany` condicional: devuelve cuántas filas cambió. */
  reclamarPeriodo(nextCharge: Date): { count: number } {
    const distinto =
      this.currentPeriodEnd === null ||
      this.currentPeriodEnd.getTime() !== nextCharge.getTime();
    if (!distinto) return { count: 0 };
    this.currentPeriodEnd = nextCharge;
    return { count: 1 };
  }
}

/** Procesa un evento y responde si le toca avisar. */
function procesar(negocio: NegocioFalso, nextCharge: Date | null): boolean {
  if (!nextCharge) return true; // sin fecha no hay nada que reclamar
  return negocio.reclamarPeriodo(nextCharge).count === 1;
}

const PERIODO = new Date('2026-09-26T23:15:49.000Z');

describe('los tres eventos de una misma compra', () => {
  it('solo uno avisa', () => {
    const n = new NegocioFalso(null);
    const avisos = [
      procesar(n, PERIODO), // checkout.session.completed
      procesar(n, PERIODO), // invoice.paid
      procesar(n, PERIODO), // invoice.payment_succeeded
    ];
    expect(avisos.filter(Boolean)).toHaveLength(1);
  });

  it('el que avisa es el PRIMERO en llegar', () => {
    const n = new NegocioFalso(null);
    expect(procesar(n, PERIODO)).toBe(true);
    expect(procesar(n, PERIODO)).toBe(false);
    expect(procesar(n, PERIODO)).toBe(false);
  });

  it('da igual cuántas veces reintente Stripe: sigue siendo uno', () => {
    const n = new NegocioFalso(null);
    const avisos = Array.from({ length: 10 }, () => procesar(n, PERIODO));
    expect(avisos.filter(Boolean)).toHaveLength(1);
  });
});

describe('lo que NO se puede romper al arreglar el duplicado', () => {
  it('una RENOVACIÓN sí avisa: es otro período', () => {
    const n = new NegocioFalso(PERIODO);
    const siguiente = new Date('2026-10-26T23:15:49.000Z');
    expect(procesar(n, siguiente)).toBe(true);
  });

  it('la primera compra de un negocio sin período avisa', () => {
    const n = new NegocioFalso(null);
    expect(procesar(n, PERIODO)).toBe(true);
  });

  it('cada renovación mensual avisa una vez, no cero', () => {
    const n = new NegocioFalso(null);
    const meses = [
      new Date('2026-09-26T00:00:00Z'),
      new Date('2026-10-26T00:00:00Z'),
      new Date('2026-11-26T00:00:00Z'),
    ];
    const avisos = meses.map((m) => procesar(n, m));
    expect(avisos).toEqual([true, true, true]);
  });

  it('sin fecha de próximo cobro se avisa igual — no se traga el aviso', () => {
    const n = new NegocioFalso(null);
    expect(procesar(n, null)).toBe(true);
  });
});

describe('el orden de llegada no importa', () => {
  it('si invoice.paid llega antes que el checkout, sigue habiendo uno solo', () => {
    const n = new NegocioFalso(null);
    const avisos = [
      procesar(n, PERIODO), // invoice.paid
      procesar(n, PERIODO), // invoice.payment_succeeded
      procesar(n, PERIODO), // checkout.session.completed (rezagado)
    ];
    expect(avisos.filter(Boolean)).toHaveLength(1);
  });
});
