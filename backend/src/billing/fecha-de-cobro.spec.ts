import { describe, it, expect } from 'vitest';
import {
  primerCobroSinFechaDeLaPasarela,
  fechaDePagoAprobado,
  diasDeFechaTardia,
} from './fecha-de-cobro';

/**
 * La fecha de cobro es el calendario del que cuelgan los avisos D-7/D-3/D-1/D-0.
 * Si miente, no falla el envío: fallan las fechas, y el negocio no recibe nada.
 *
 * OJO con la historia: la raíz del caso Café Macondo se arregló el 2026-08-18
 * (`f8b067df`, `nextChargeFromPayload` leyendo `purchase.date_next_charge`).
 * Lo que se prueba aquí es el CINTURÓN para el payload que no traiga esa fecha:
 * que se cuente desde el pago, y que el resultado no nazca ya vencido.
 */

// Compra real y día en que llegó el webhook (cierre de la garantía de Hotmart).
const PAGO = new Date('2026-06-16T13:41:22Z');
const WEBHOOK_TARDIO = new Date('2026-06-24T08:29:35Z');

describe('primerCobroSinFechaDeLaPasarela', () => {
  it('EL CASO MACONDO: ancla en el pago, no en el día del webhook', () => {
    const r = primerCobroSinFechaDeLaPasarela(PAGO, WEBHOOK_TARDIO, 'TRIMESTRAL');
    // 16-jun + 3 meses = 16-sep, que es cuando Hotmart cobra de verdad.
    expect(r.fecha.toISOString()).toBe('2026-09-16T13:41:22.000Z');
    expect(r.ancla).toBe('pago');
    expect(r.ciclosAdelantados).toBe(0);
  });

  it('un webhook que llega TARDE ya no adelanta la fecha de cobro', () => {
    // Lo que hacía antes: addPlanPeriod(new Date(), …) = 24-09. Ocho días tarde,
    // y ese hueco no se corrige nunca.
    const r = primerCobroSinFechaDeLaPasarela(PAGO, WEBHOOK_TARDIO, 'TRIMESTRAL');
    expect(r.fecha.toISOString()).not.toBe('2026-09-24T08:29:35.000Z');
    const diasDeDesfase =
      (new Date('2026-09-24T08:29:35Z').getTime() - r.fecha.getTime()) /
      (24 * 60 * 60 * 1000);
    expect(Math.round(diasDeDesfase)).toBe(8);
  });

  it('sin fecha de pago aprobado no queda más remedio que contar desde hoy', () => {
    const r = primerCobroSinFechaDeLaPasarela(null, WEBHOOK_TARDIO, 'TRIMESTRAL');
    expect(r.fecha.toISOString()).toBe('2026-09-24T08:29:35.000Z');
    expect(r.ancla).toBe('hoy');
  });

  it('respeta la periodicidad del plan (no son 30 días fijos)', () => {
    expect(
      primerCobroSinFechaDeLaPasarela(PAGO, PAGO, 'MENSUAL').fecha.toISOString(),
    ).toBe('2026-07-16T13:41:22.000Z');
    expect(
      primerCobroSinFechaDeLaPasarela(PAGO, PAGO, 'SEMESTRAL').fecha.toISOString(),
    ).toBe('2026-12-16T13:41:22.000Z');
    expect(
      primerCobroSinFechaDeLaPasarela(PAGO, PAGO, 'ANUAL').fecha.toISOString(),
    ).toBe('2027-06-16T13:41:22.000Z');
    // Periodicidad desconocida = MENSUAL, la convención de todo el módulo.
    expect(
      primerCobroSinFechaDeLaPasarela(PAGO, PAGO, null).fecha.toISOString(),
    ).toBe('2026-07-16T13:41:22.000Z');
  });

  // ── La cota inferior: el hueco que abre anclar en el pago ──────────────────
  // Sin esto el negocio nace VENCIDO con failedPaymentCount=0 → decideDunning
  // ancla en currentPeriodEnd, lo manda a D+1 y lo suspende PAGANDO.

  it('NUNCA devuelve una fecha en el pasado: un pago viejo no nace vencido', () => {
    // Un pendiente de marzo que se consume en septiembre: marzo + 3 meses = junio.
    const ahora = new Date('2026-09-16T10:00:00Z');
    const pagoViejo = new Date('2026-03-10T09:00:00Z');
    const r = primerCobroSinFechaDeLaPasarela(pagoViejo, ahora, 'TRIMESTRAL');
    expect(r.fecha.getTime()).toBeGreaterThan(ahora.getTime());
    expect(r.ciclosAdelantados).toBeGreaterThan(0);
    // Avanza por ciclos COMPLETOS, así que conserva el día de cobro del plan.
    expect(r.fecha.toISOString()).toBe('2026-12-10T09:00:00.000Z');
  });

  it('avanza los ciclos que hagan falta, no solo uno', () => {
    const ahora = new Date('2026-09-16T10:00:00Z');
    const pagoMuyViejo = new Date('2026-01-10T09:00:00Z');
    const r = primerCobroSinFechaDeLaPasarela(pagoMuyViejo, ahora, 'MENSUAL');
    expect(r.fecha.getTime()).toBeGreaterThan(ahora.getTime());
    expect(r.fecha.toISOString()).toBe('2026-10-10T09:00:00.000Z');
    expect(r.ciclosAdelantados).toBe(8);
  });

  it('un pago de hoy mismo no se adelanta ningún ciclo', () => {
    const r = primerCobroSinFechaDeLaPasarela(PAGO, PAGO, 'MENSUAL');
    expect(r.ciclosAdelantados).toBe(0);
  });
});

describe('fechaDePagoAprobado — lo que llega por un webhook', () => {
  it('acepta el epoch en MILISEGUNDOS, que es lo que manda Hotmart', () => {
    const ms = Date.UTC(2026, 5, 16, 13, 41, 22);
    expect(fechaDePagoAprobado(ms)?.toISOString()).toBe('2026-06-16T13:41:22.000Z');
  });

  it('RECHAZA el epoch en SEGUNDOS en vez de leerlo como 1970', () => {
    // 1781000000 s = jun-2026; como ms sería el 21 de enero de 1970, y esa
    // fecha acabaría escrita en lastChargeAt y purchasedAt.
    expect(fechaDePagoAprobado(1781000000)).toBeNull();
  });

  it('RECHAZA el número en STRING en vez de devolver Invalid Date', () => {
    // `new Date('1781000000000')` es Invalid Date y el toISOString() del log
    // revienta con RangeError a mitad del webhook.
    expect(fechaDePagoAprobado('1781000000')).toBeNull();
  });

  it('un string numérico en MILISEGUNDOS sí es una fecha creíble', () => {
    const ms = String(Date.UTC(2026, 5, 16, 13, 41, 22));
    expect(fechaDePagoAprobado(ms)?.toISOString()).toBe('2026-06-16T13:41:22.000Z');
  });

  it('acepta la fecha en texto ISO', () => {
    expect(fechaDePagoAprobado('2026-06-16T13:41:22Z')?.toISOString()).toBe(
      '2026-06-16T13:41:22.000Z',
    );
  });

  it('ausente, vacía o basura → null (el llamador cae a hoy)', () => {
    expect(fechaDePagoAprobado(null)).toBeNull();
    expect(fechaDePagoAprobado(undefined)).toBeNull();
    expect(fechaDePagoAprobado('')).toBeNull();
    expect(fechaDePagoAprobado('ayer por la tarde')).toBeNull();
    expect(fechaDePagoAprobado(0)).toBeNull();
  });
});

describe('diasDeFechaTardia — el caso simétrico de paidButStale', () => {
  it('EL CASO MACONDO: 8 días por delante del ciclo real', () => {
    const macondo = {
      currentPeriodEnd: new Date('2026-09-24T08:29:35Z'),
      lastChargeAt: PAGO,
      planPeriodicity: 'TRIMESTRAL',
    };
    expect(diasDeFechaTardia(macondo)).toBe(8);
  });

  it('una fecha alineada con el ciclo real no es desfase', () => {
    expect(
      diasDeFechaTardia({
        currentPeriodEnd: new Date('2026-09-16T13:41:22Z'),
        lastChargeAt: PAGO,
        planPeriodicity: 'TRIMESTRAL',
      }),
    ).toBeNull();
  });

  it('el drift de horas/un día de la pasarela NO cuenta como desfase', () => {
    expect(
      diasDeFechaTardia({
        currentPeriodEnd: new Date('2026-09-17T13:41:22Z'),
        lastChargeAt: PAGO,
        planPeriodicity: 'TRIMESTRAL',
      }),
    ).toBeNull();
  });

  it('NO se mete en el terreno de paidButStale: una fecha ATRASADA da null', () => {
    // Fecha anterior al ciclo real = el caso Quipao, que ya sana paidButStale.
    expect(
      diasDeFechaTardia({
        currentPeriodEnd: new Date('2026-08-16T13:41:22Z'),
        lastChargeAt: PAGO,
        planPeriodicity: 'TRIMESTRAL',
      }),
    ).toBeNull();
  });

  it('sin último cobro o sin fecha de ciclo no se afirma nada', () => {
    expect(
      diasDeFechaTardia({
        currentPeriodEnd: new Date('2026-09-24T08:29:35Z'),
        lastChargeAt: null,
        planPeriodicity: 'TRIMESTRAL',
      }),
    ).toBeNull();
    expect(
      diasDeFechaTardia({
        currentPeriodEnd: null,
        lastChargeAt: PAGO,
        planPeriodicity: 'TRIMESTRAL',
      }),
    ).toBeNull();
  });

  it('detecta los desfases grandes de producción (Birria León, 195 días)', () => {
    const birria = {
      currentPeriodEnd: new Date('2027-01-12T12:01:29Z'),
      lastChargeAt: new Date('2026-01-01T12:01:29Z'),
      planPeriodicity: 'SEMESTRAL',
    };
    expect(diasDeFechaTardia(birria)).toBe(195);
  });
});
