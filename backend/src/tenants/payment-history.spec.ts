import { describe, it, expect } from 'vitest';
import { agruparCobrosHotmart, resumirHistorial } from './payment-history.util';

/**
 * Historial de pagos: qué se le cobró al negocio y si entró.
 *
 * El riesgo aquí no es que falte un dato, es que SOBRE: Hotmart manda varios
 * eventos por el mismo cobro y contarlos sueltos duplicaría los ingresos de
 * todos los negocios. Medido en producción: Wok Explosivo tiene 9 eventos que
 * son 7 cobros, y Quipao 10 eventos que son 5 cobros.
 */

const ms = (iso: string) => new Date(iso).getTime();

function evento(
  eventType: string,
  transaction: string,
  extra: Record<string, unknown> = {},
) {
  return {
    eventType,
    processedAt: new Date('2026-08-31T00:00:00Z'),
    payload: {
      data: {
        purchase: {
          transaction,
          order_date: ms('2026-08-01T10:00:00Z'),
          full_price: { value: 191900, currency_value: 'COP' },
          price: { value: 190038.57, currency_value: 'COP' },
          payment: { type: 'CREDIT_CARD' },
          recurrence_number: 3,
          ...extra,
        },
      },
    },
  };
}

describe('un cobro es un cobro, aunque lleguen varios eventos', () => {
  it('APPROVED y COMPLETE de la misma transacción son UN pago', () => {
    // Hotmart manda COMPLETE ~8 días después, al vencer la garantía. Sin
    // agrupar, cada mes cobrado aparecería dos veces.
    const r = agruparCobrosHotmart([
      evento('PURCHASE_APPROVED', 'HP001', {
        approved_date: ms('2026-08-01T10:00:05Z'),
      }),
      evento('PURCHASE_COMPLETE', 'HP001', {
        approved_date: ms('2026-08-01T10:00:05Z'),
      }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].estado).toBe('PAGADO');
  });

  it('transacciones distintas son cobros distintos', () => {
    const r = agruparCobrosHotmart([
      evento('PURCHASE_APPROVED', 'HP001'),
      evento('PURCHASE_APPROVED', 'HP002'),
    ]);
    expect(r).toHaveLength(2);
  });
});

describe('gana el estado más definitivo, no el último que llegó', () => {
  it('rechazado y luego aprobado en la misma transacción está PAGADO', () => {
    const r = agruparCobrosHotmart([
      evento('PURCHASE_DELAYED', 'HP001', {
        payment: { type: 'CREDIT_CARD', refusal_reason: 'Saldo insuficiente.' },
      }),
      evento('PURCHASE_APPROVED', 'HP001'),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].estado).toBe('PAGADO');
    // Ya no es un rechazo: no debe arrastrar el motivo.
    expect(r[0].motivo).toBeNull();
  });

  it('un contracargo pesa más que el pago y más que el reembolso', () => {
    // Caso real de Quipao: cobró, se reembolsó y acabó en contracargo.
    const r = agruparCobrosHotmart([
      evento('PURCHASE_APPROVED', 'HP001'),
      evento('PURCHASE_REFUNDED', 'HP001'),
      evento('PURCHASE_PROTEST', 'HP001'),
    ]);
    expect(r[0].estado).toBe('CONTRACARGO');
  });

  it('el orden en que llegan no cambia el resultado', () => {
    const a = agruparCobrosHotmart([
      evento('PURCHASE_PROTEST', 'HP001'),
      evento('PURCHASE_APPROVED', 'HP001'),
    ]);
    expect(a[0].estado).toBe('CONTRACARGO');
  });
});

describe('los eventos que no hablan de dinero no ensucian el historial', () => {
  it('CLUB_FIRST_ACCESS no es un cobro', () => {
    expect(
      agruparCobrosHotmart([
        evento('CLUB_FIRST_ACCESS', 'HP001'),
        evento('CLUB_MODULE_COMPLETED', 'HP002'),
      ]),
    ).toHaveLength(0);
  });
});

describe('el importe es lo que se le cobró al negocio', () => {
  it('usa full_price, no price: price ya lleva descontada la comisión', () => {
    const [p] = agruparCobrosHotmart([evento('PURCHASE_APPROVED', 'HP001')]);
    expect(p.monto).toBe(191900);
    expect(p.moneda).toBe('COP');
  });

  it('la moneda sale de currency_value — currency_code no existe acá', () => {
    const [p] = agruparCobrosHotmart([
      evento('PURCHASE_APPROVED', 'HP001', {
        full_price: { value: 50, currency_value: 'USD' },
      }),
    ]);
    expect(p.moneda).toBe('USD');
  });

  it('cobrado en COP, muestra también el precio en USD de la oferta', () => {
    // Sin esto no se pueden comparar dos negocios que pagan en monedas
    // distintas, que es la mitad de la cartera.
    const [p] = agruparCobrosHotmart([
      evento('PURCHASE_APPROVED', 'HP001', {
        original_offer_price: { value: 69.92, currency_value: 'USD' },
      }),
    ]);
    expect(p.montoUsd).toBe(69.92);
  });

  it('no inventa un importe en USD si Hotmart no lo dio', () => {
    const [p] = agruparCobrosHotmart([evento('PURCHASE_APPROVED', 'HP001')]);
    expect(p.montoUsd).toBeNull();
  });
});

describe('la fecha es la del cobro, no la del webhook', () => {
  it('un pago se fecha por approved_date', () => {
    const [p] = agruparCobrosHotmart([
      evento('PURCHASE_APPROVED', 'HP001', {
        approved_date: ms('2026-08-03T15:00:00Z'),
      }),
    ]);
    expect(p.fecha.toISOString().slice(0, 10)).toBe('2026-08-03');
  });

  it('un rechazo se fecha por order_date: nunca hubo aprobación', () => {
    const [p] = agruparCobrosHotmart([
      evento('PURCHASE_DELAYED', 'HP001', {
        order_date: ms('2026-08-26T09:00:00Z'),
        payment: { type: 'CREDIT_CARD', refusal_reason: 'Saldo insuficiente.' },
      }),
    ]);
    expect(p.fecha.toISOString().slice(0, 10)).toBe('2026-08-26');
    expect(p.motivo).toBe('Saldo insuficiente.');
  });

  it('sin fechas usables cae a la del webhook y no revienta', () => {
    const [p] = agruparCobrosHotmart([
      evento('PURCHASE_APPROVED', 'HP001', {
        order_date: 0,
        approved_date: null,
      }),
    ]);
    expect(p.fecha.toISOString().slice(0, 10)).toBe('2026-08-31');
  });
});

/**
 * ── El resumen ────────────────────────────────────────────────────────────
 *
 * Es lo primero que se lee, así que un falso positivo aquí es peor que no
 * mostrarlo: haría perseguir a un negocio que está al día.
 */
describe('«¿está pagando?» — solo cuentan los rechazos sin resolver', () => {
  const pago = (fecha: string, estado: any, motivo: string | null = null) =>
    ({
      id: fecha,
      fecha: new Date(fecha),
      origen: 'HOTMART',
      estado,
      monto: 100,
      moneda: 'USD',
      montoUsd: 100,
      metodo: null,
      motivo,
      referencia: null,
      numeroDeCobro: null,
      cubreDesde: null,
      cubreHasta: null,
      nota: null,
    }) as const;

  it('un rechazo ANTERIOR al último pago ya está resuelto', () => {
    // Wok Explosivo: rechazado el 29-07, pagado el 03-08. Ese rechazo no es
    // un problema abierto — si contara, la alarma sonaría todos los meses.
    const r = resumirHistorial([
      pago('2026-08-03', 'PAGADO'),
      pago('2026-07-29', 'RECHAZADO', 'Saldo insuficiente.'),
    ] as any);
    expect(r.cobrosFallidos).toBe(0);
    expect(r.ultimoRechazoMotivo).toBeNull();
  });

  it('un rechazo POSTERIOR al último pago sí exige actuar', () => {
    const r = resumirHistorial([
      pago('2026-08-26', 'RECHAZADO', 'Saldo insuficiente.'),
      pago('2026-08-03', 'PAGADO'),
    ] as any);
    expect(r.cobrosFallidos).toBe(1);
    expect(r.ultimoRechazoMotivo).toBe('Saldo insuficiente.');
    expect(r.ultimoPagoEn?.toISOString().slice(0, 10)).toBe('2026-08-03');
  });

  it('sin ningún pago, todos los rechazos están abiertos', () => {
    const r = resumirHistorial([
      pago('2026-08-26', 'RECHAZADO', 'Saldo insuficiente.'),
      pago('2026-07-26', 'RECHAZADO', 'Saldo insuficiente.'),
    ] as any);
    expect(r.cobrosFallidos).toBe(2);
    expect(r.ultimoPagoEn).toBeNull();
  });

  it('cuenta reembolsos y contracargos aparte de los pagos', () => {
    const r = resumirHistorial([
      pago('2026-08-01', 'PAGADO'),
      pago('2026-07-04', 'CONTRACARGO'),
      pago('2026-06-04', 'REEMBOLSADO'),
    ] as any);
    expect(r.pagosCorrectos).toBe(1);
    expect(r.contracargos).toBe(1);
    expect(r.reembolsos).toBe(1);
    expect(r.cobrosFallidos).toBe(0);
  });

  it('un historial vacío no rompe nada', () => {
    const r = resumirHistorial([]);
    expect(r.totalCobros).toBe(0);
    expect(r.cobrosFallidos).toBe(0);
    expect(r.ultimoPagoEn).toBeNull();
  });
});
