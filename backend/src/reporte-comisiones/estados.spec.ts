import { describe, it, expect } from 'vitest';
import {
  ESTADOS,
  estadoDeComision,
  estaEnRevision,
  idsEnRevision,
  motivoParaNoPermitir,
  whereDeEstado,
  type DatosDeEstado,
} from './estados';

const fila = (p: Partial<DatosDeEstado> = {}): DatosDeEstado => ({
  status: 'PENDING',
  paymentStatus: 'PENDING',
  amount: 10,
  amountPaid: 0,
  payoutBatchId: null,
  ...p,
});

describe('los siete estados salen del modelo real', () => {
  it.each([
    [{ status: 'PENDING' }, 'GENERADA'],
    [{ status: 'APPROVED' }, 'APROBADA'],
    [{ status: 'APPROVED', payoutBatchId: 'b1' }, 'PENDIENTE_PAGO'],
    [{ status: 'APPROVED', paymentStatus: 'PARTIAL', amountPaid: 4 }, 'PENDIENTE_PAGO'],
    [{ status: 'PAID', paymentStatus: 'PAID', amountPaid: 10 }, 'PAGADA'],
    // El dinero manda: el `status` se quedó atrás pero ya se pagó.
    [{ status: 'APPROVED', paymentStatus: 'PAID', amountPaid: 10 }, 'PAGADA'],
    [{ status: 'RETAINED' }, 'RETENIDA'],
    [{ status: 'REJECTED' }, 'REVERSADA'],
    // Reversada gana aunque tenga un pago viejo marcado.
    [{ status: 'REJECTED', paymentStatus: 'PAID' }, 'REVERSADA'],
  ] as const)('%o → %s', (p, esperado) => {
    expect(estadoDeComision(fila(p as Partial<DatosDeEstado>))).toBe(esperado);
  });

  it('una retenida marcada desde el reporte es «En revisión»', () => {
    expect(estadoDeComision(fila({ status: 'RETAINED' }), { enRevision: true })).toBe('EN_REVISION');
  });

  it('el asiento ADJUSTMENT no es una comisión', () => {
    expect(estadoDeComision(fila({ status: 'ADJUSTMENT' }))).toBeNull();
  });
});

/**
 * Evaluador mínimo de los `where` de Prisma que usa `whereDeEstado`, para
 * comprobar que el filtro de la base y la etiqueta de la fila dicen lo mismo.
 */
function cumple(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Record<string, unknown>[]).some((w) => cumple(row, w));
    if (k === 'AND') return (cond as Record<string, unknown>[]).every((w) => cumple(row, w));
    const v = row[k];
    if (cond === null || typeof cond !== 'object') return v === cond;
    const c = cond as Record<string, unknown>;
    if ('in' in c && !(c.in as unknown[]).includes(v)) return false;
    if ('notIn' in c && (c.notIn as unknown[]).includes(v)) return false;
    if ('not' in c && v === c.not) return false;
    if ('gt' in c && !(Number(v) > Number(c.gt))) return false;
    return true;
  });
}

describe('el filtro de la base coincide con la etiqueta (una sola regla)', () => {
  const statuses = ['PENDING', 'APPROVED', 'PAID', 'REJECTED', 'RETAINED'];
  const pagos = ['PENDING', 'PARTIAL', 'PAID'];
  const combinaciones: Array<DatosDeEstado & { id: string }> = [];
  let n = 0;
  for (const status of statuses)
    for (const paymentStatus of pagos)
      for (const amountPaid of [0, 5])
        for (const payoutBatchId of [null, 'b1'])
          combinaciones.push({ id: `c${n++}`, status, paymentStatus, amount: 10, amountPaid, payoutBatchId });
  // La mitad de las retenidas, en revisión.
  const enRevision = combinaciones.filter((c, i) => c.status === 'RETAINED' && i % 2 === 0).map((c) => c.id);

  it('cada combinación cae en EXACTAMENTE el estado que dice su etiqueta', () => {
    for (const c of combinaciones) {
      const etiqueta = estadoDeComision(c, { enRevision: enRevision.includes(c.id) });
      const encajan = ESTADOS.filter((e) => cumple(c as unknown as Record<string, unknown>, whereDeEstado(e, enRevision)));
      expect({ c, encajan }).toEqual({ c, encajan: [etiqueta] });
    }
  });
});

describe('«En revisión» sale de la bitácora del reporte', () => {
  it('la última acción que cuenta decide', () => {
    expect(
      estaEnRevision([
        { accion: 'RETENER', createdAt: '2026-10-01T00:00:00Z' },
        { accion: 'ENVIAR_A_REVISION', createdAt: '2026-10-02T00:00:00Z' },
      ]),
    ).toBe(true);
    expect(
      estaEnRevision([
        { accion: 'CREAR_EN_REVISION', createdAt: '2026-10-01T00:00:00Z' },
        { accion: 'RETENER', createdAt: '2026-10-03T00:00:00Z' },
      ]),
    ).toBe(false);
  });

  it('las notas no cambian el estado', () => {
    expect(
      estaEnRevision([
        { accion: 'ENVIAR_A_REVISION', createdAt: '2026-10-01T00:00:00Z' },
        { accion: 'NOTA_AGREGADA', createdAt: '2026-10-05T00:00:00Z' },
      ]),
    ).toBe(true);
  });

  it('agrupa por comisión', () => {
    expect(
      idsEnRevision([
        { commissionId: 'a', accion: 'ENVIAR_A_REVISION', createdAt: '2026-10-01' },
        { commissionId: 'b', accion: 'ENVIAR_A_REVISION', createdAt: '2026-10-01' },
        { commissionId: 'b', accion: 'APROBAR', createdAt: '2026-10-02' },
      ]),
    ).toEqual(['a']);
  });
});

describe('lo pagado no se retracta', () => {
  it('una pagada no admite ninguna acción', () => {
    expect(motivoParaNoPermitir('PAGADA', 'REVERSAR', { amountPaid: 10 })).toMatch(/pagado/);
  });
  it('una con abono tampoco, aunque siga «pendiente de pago»', () => {
    expect(motivoParaNoPermitir('PENDIENTE_PAGO', 'RETENER', { amountPaid: 3 })).toMatch(/pagado/);
  });
  it('una reversada no vuelve', () => {
    expect(motivoParaNoPermitir('REVERSADA', 'APROBAR', { amountPaid: 0 })).toMatch(/reversada/);
  });
  it('aprobar solo lo que no está aprobado', () => {
    expect(motivoParaNoPermitir('GENERADA', 'APROBAR', { amountPaid: 0 })).toBeNull();
    expect(motivoParaNoPermitir('EN_REVISION', 'APROBAR', { amountPaid: 0 })).toBeNull();
    expect(motivoParaNoPermitir('APROBADA', 'APROBAR', { amountPaid: 0 })).not.toBeNull();
  });
});
