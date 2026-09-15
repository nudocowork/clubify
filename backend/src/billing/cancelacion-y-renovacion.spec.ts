import { describe, it, expect } from 'vitest';
import {
  desconectaAlCancelar,
  esPrimeraCompraHotmart,
  type HotmartWebhookPayload,
} from './hotmart.service';
import { textoDeCancelacion } from './billing.service';

/**
 * Lo que pasó el 15-09-2026, en dos minutos:
 *
 *  - 08:59 VALMONT BARBERIA cancela tras dos cobros fallidos. Nadie del equipo
 *    se entera y el negocio sigue ACTIVO hasta el 13-10 sin haber pagado.
 *  - 09:01 Essentrix paga su 2º cobro. Como su primer pago no dejó
 *    transacción, sale como «🎉 Nueva compra» y al cliente le llega el correo
 *    de bienvenida.
 */

/** El `purchase` real de la renovación de Essentrix (recortado). */
const RENOVACION_ESSENTRIX = {
  event: 'PURCHASE_APPROVED',
  data: {
    purchase: {
      transaction: 'HP3542288782',
      status: 'APPROVED',
      recurrence_number: 2,
    },
  },
} as unknown as HotmartWebhookPayload;

const conRecurrencia = (n: unknown) =>
  ({
    event: 'PURCHASE_APPROVED',
    data: { purchase: { transaction: 'HP1', recurrence_number: n } },
  }) as unknown as HotmartWebhookPayload;

describe('primera compra o renovación', () => {
  it('la recurrencia 2 es renovación aunque el negocio no tenga transacción guardada', () => {
    expect(esPrimeraCompraHotmart(RENOVACION_ESSENTRIX, { hotmartTransactionId: null })).toBe(false);
  });

  it('también cuando la recurrencia llega como texto', () => {
    expect(esPrimeraCompraHotmart(conRecurrencia('3'), { hotmartTransactionId: null })).toBe(false);
  });

  it('la recurrencia 1 sigue mirando la transacción: una resuscripción no es un cliente nuevo', () => {
    expect(esPrimeraCompraHotmart(conRecurrencia(1), { hotmartTransactionId: null })).toBe(true);
    expect(esPrimeraCompraHotmart(conRecurrencia(1), { hotmartTransactionId: 'HP0' })).toBe(false);
  });

  it('sin recurrencia, lo de siempre', () => {
    const sinDato = { event: 'PURCHASE_APPROVED', data: { purchase: { transaction: 'HP1' } } } as HotmartWebhookPayload;
    expect(esPrimeraCompraHotmart(sinDato, { hotmartTransactionId: null })).toBe(true);
    expect(esPrimeraCompraHotmart(sinDato, { hotmartTransactionId: 'HP0' })).toBe(false);
    expect(esPrimeraCompraHotmart(conRecurrencia('basura'), { hotmartTransactionId: null })).toBe(true);
  });
});

describe('¿la cancelación desconecta ya?', () => {
  const HOY = new Date('2026-09-15T13:59:27Z');

  it('con el último cobro fallido, sí: no hay días pagados que respetar (VALMONT)', () => {
    expect(
      desconectaAlCancelar({ failedPaymentCount: 2, currentPeriodEnd: new Date('2026-10-13T00:00:00Z') }, HOY),
    ).toBe(true);
  });

  it('con días pagados por delante, no: sigue hasta que venzan (decisión del 10-09)', () => {
    expect(
      desconectaAlCancelar({ failedPaymentCount: 0, currentPeriodEnd: new Date('2026-09-25T00:00:00Z') }, HOY),
    ).toBe(false);
  });

  it('con el período ya vencido, o sin período, sí', () => {
    expect(desconectaAlCancelar({ failedPaymentCount: 0, currentPeriodEnd: new Date('2026-09-01T00:00:00Z') }, HOY)).toBe(true);
    expect(desconectaAlCancelar({ failedPaymentCount: 0, currentPeriodEnd: null }, HOY)).toBe(true);
  });

  it('un negocio ya suspendido o en prueba no se suspende otra vez aquí (Fable)', () => {
    expect(
      desconectaAlCancelar({ status: 'SUSPENDED', failedPaymentCount: 3, currentPeriodEnd: null }, HOY),
    ).toBe(false);
    expect(
      desconectaAlCancelar({ status: 'TRIAL', failedPaymentCount: 0, currentPeriodEnd: null }, HOY),
    ).toBe(false);
    expect(
      desconectaAlCancelar({ status: 'ACTIVE', failedPaymentCount: 2, currentPeriodEnd: null }, HOY),
    ).toBe(true);
  });
});

describe('el SMS al equipo', () => {
  it('dice que ya se desconectó', () => {
    expect(
      textoDeCancelacion('VALMONT BARBERIA', 'cancelacion', {
        desconectado: true,
        hasta: new Date('2026-10-13T00:00:00Z'),
      }),
    ).toBe('🚫 CANCELÓ la suscripción: VALMONT BARBERIA. Servicio desconectado. (Clubify)');
  });

  it('o hasta cuándo sigue, en hora de Bogotá', () => {
    // Las 02:00 UTC del 26 son todavía el 25 en Bogotá.
    expect(
      textoDeCancelacion('Laly.com', 'cancelacion', {
        desconectado: false,
        hasta: new Date('2026-09-26T02:00:00Z'),
      }),
    ).toBe(
      '🚫 CANCELÓ la suscripción: Laly.com. Pagó hasta el 25/09/2026: ese día se desconecta solo. (Clubify)',
    );
  });

  it('sin fecha ni desconexión (una prueba), solo el aviso', () => {
    expect(textoDeCancelacion('X', 'cancelacion', { desconectado: false, hasta: null })).toBe(
      '🚫 CANCELÓ la suscripción: X. (Clubify)',
    );
  });

  it('distingue reembolso y contracargo', () => {
    const ya = { desconectado: true, hasta: null };
    expect(textoDeCancelacion('X', 'reembolso', ya)).toContain('💸 REEMBOLSO: X');
    expect(textoDeCancelacion('X', 'contracargo', ya)).toContain('💸 CONTRACARGO: X');
  });
});
