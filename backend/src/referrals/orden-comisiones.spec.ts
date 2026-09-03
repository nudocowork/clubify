import { describe, it, expect } from 'vitest';

/**
 * El listado de comisiones se ordena por la fecha que SE VE.
 *
 * El fallo (31-08-2026): la tabla mostraba la fecha de COMPRA y el filtro
 * operaba sobre ella, pero el orden se hacía por `createdAt` — cuándo se creó
 * la fila. Resultado: la lista salía desordenada respecto a su propia columna.
 *
 * No era un caso de borde. Medido en producción: 51 de las 99 comisiones con
 * fecha de compra la tenían a más de 36 h de la creación de su fila. Pasa
 * siempre que la comisión se genera después de la venta — reconciliaciones,
 * cobros retroactivos, backfills.
 */

type Fila = {
  businessDate: Date | null;
  paidAt: Date | null;
  createdAt: Date;
};

const d = (s: string) => new Date(s);

/** Espejo del `orderBy` del servicio. */
function ordenar(filas: Fila[], dateType: 'purchase' | 'payment'): Fila[] {
  const campo = dateType === 'payment' ? 'paidAt' : 'businessDate';
  return [...filas].sort((a, b) => {
    const va = a[campo];
    const vb = b[campo];
    // nulls al final, como `nulls: 'last'`
    if (!va && !vb) return b.createdAt.getTime() - a.createdAt.getTime();
    if (!va) return 1;
    if (!vb) return -1;
    const dif = vb.getTime() - va.getTime();
    return dif !== 0 ? dif : b.createdAt.getTime() - a.createdAt.getTime();
  });
}

describe('se ordena por la fecha de compra, no por cuándo se creó la fila', () => {
  it('una comisión vieja creada hoy NO encabeza la lista', () => {
    // El caso real: un cobro retroactivo de una venta de junio, registrado hoy.
    const retroactiva: Fila = {
      businessDate: d('2026-06-15'),
      paidAt: null,
      createdAt: d('2026-08-31'),
    };
    const reciente: Fila = {
      businessDate: d('2026-08-30'),
      paidAt: null,
      createdAt: d('2026-08-30'),
    };
    const r = ordenar([retroactiva, reciente], 'purchase');
    expect(r[0]).toBe(reciente);
    expect(r[1]).toBe(retroactiva);
  });

  it('el orden es descendente por fecha de compra', () => {
    const filas: Fila[] = [
      { businessDate: d('2026-07-01'), paidAt: null, createdAt: d('2026-08-01') },
      { businessDate: d('2026-08-20'), paidAt: null, createdAt: d('2026-08-02') },
      { businessDate: d('2026-06-10'), paidAt: null, createdAt: d('2026-08-03') },
    ];
    const fechas = ordenar(filas, 'purchase').map((f) =>
      f.businessDate!.toISOString().slice(0, 10),
    );
    expect(fechas).toEqual(['2026-08-20', '2026-07-01', '2026-06-10']);
  });
});

describe('las que no tienen fecha van al final', () => {
  it('sin fecha de compra no encabezan la lista', () => {
    // Postgres pone los nulos ARRIBA en DESC: sin `nulls: last`, las 9
    // comisiones sin fecha de producción saldrían primero.
    const sinFecha: Fila = { businessDate: null, paidAt: null, createdAt: d('2026-08-31') };
    const conFecha: Fila = { businessDate: d('2026-01-01'), paidAt: null, createdAt: d('2026-01-01') };
    const r = ordenar([sinFecha, conFecha], 'purchase');
    expect(r[0]).toBe(conFecha);
    expect(r[1]).toBe(sinFecha);
  });
});

describe('al filtrar por fecha de pago, se ordena por fecha de pago', () => {
  it('manda paidAt, no businessDate', () => {
    const a: Fila = { businessDate: d('2026-08-01'), paidAt: d('2026-08-10'), createdAt: d('2026-08-01') };
    const b: Fila = { businessDate: d('2026-08-20'), paidAt: d('2026-08-05'), createdAt: d('2026-08-02') };
    // Por compra mandaría b; por pago manda a.
    expect(ordenar([a, b], 'purchase')[0]).toBe(b);
    expect(ordenar([a, b], 'payment')[0]).toBe(a);
  });
});

describe('dos compras del mismo día salen siempre igual', () => {
  it('desempata por creación, para que el orden no baile entre recargas', () => {
    const antigua: Fila = { businessDate: d('2026-08-20'), paidAt: null, createdAt: d('2026-08-20T08:00:00Z') };
    const nueva: Fila = { businessDate: d('2026-08-20'), paidAt: null, createdAt: d('2026-08-20T18:00:00Z') };
    expect(ordenar([antigua, nueva], 'purchase')[0]).toBe(nueva);
    expect(ordenar([nueva, antigua], 'purchase')[0]).toBe(nueva);
  });
});
