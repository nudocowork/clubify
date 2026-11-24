import { describe, it, expect, vi } from 'vitest';
import { CutoffService } from './cutoff.service';

/**
 * El ajuste por recuperar de una devolución se descuenta del SIGUIENTE pago a
 * esa persona (Javier, 2026-11-23). Nunca por debajo de cero: lo que no alcanza
 * queda para el pago siguiente.
 */

const PAGO = new Date('2026-11-30T17:00:00.000Z');

function montar(ajustes: Array<{ id: string; amount: number; createdAt?: Date }>) {
  const filas: any[] = ajustes.map((a, i) => ({
    status: 'ADJUSTMENT',
    paymentStatus: 'PENDING',
    amountPaid: 0,
    recipientCodeId: 'rc-influencer',
    referralUseId: 'use-1',
    businessGroupId: null,
    externalTxId: 'HP0032012122',
    periodKey: `DEVOL-HP0032012122-c${i + 1}`,
    notes: 'Ajuste por recuperar',
    payoutBatchId: null,
    createdAt: new Date(2026, 10, 23, 12, i),
    ...a,
  }));
  const tx: any = {
    commission: {
      findMany: async ({ where }: any) =>
        filas.filter(
          (f) =>
            f.status === 'ADJUSTMENT' &&
            f.paymentStatus === where.paymentStatus &&
            (!where.recipientCodeId || f.recipientCodeId === where.recipientCodeId) &&
            (!where.payoutBatchId || f.payoutBatchId === where.payoutBatchId) &&
            (where.paymentStatus !== 'PENDING' || f.amount < 0),
        ),
      updateMany: async ({ where, data }: any) => {
        const f = filas.find((x) => x.id === where.id && x.paymentStatus === where.paymentStatus);
        if (!f) return { count: 0 };
        Object.assign(f, data);
        return { count: 1 };
      },
      update: async ({ where, data }: any) => Object.assign(filas.find((x) => x.id === where.id), data),
      create: async ({ data }: any) => {
        const f = { id: `resto${filas.length}`, createdAt: new Date(), ...data };
        filas.push(f);
        return f;
      },
    },
  };
  const svc = new CutoffService({} as any, {} as any, {} as any, {} as any);
  vi.spyOn(svc as any, 'recalcBatchTotal').mockImplementation(async () => 0);
  const aplicar = (disponible: number) =>
    (svc as any).aplicarAjustes(tx, {
      batchId: 'b-30nov',
      batchCode: 'CORTE-2026-11-30',
      recipientCodeId: 'rc-influencer',
      disponible,
      paidAt: PAGO,
      stamp: '2026-11-30',
    });
  const devolver = () => (svc as any).devolverAjustes(tx, { batchId: 'b-30nov', recipientCodeId: 'rc-influencer' });
  return { filas, aplicar, devolver };
}

describe('descontar del siguiente corte', () => {
  it('le alcanza: se descuenta entero y el ajuste queda aplicado en ese corte', async () => {
    const { filas, aplicar } = montar([{ id: 'aj1', amount: -7.5 }]);
    const descontado = await aplicar(30);
    expect(descontado).toBe(7.5);
    expect(filas[0]).toMatchObject({ paymentStatus: 'PAID', amountPaid: -7.5, payoutBatchId: 'b-30nov', paidAt: PAGO });
    expect(filas[0].notes).toContain('Descontado en el corte CORTE-2026-11-30: -$7.50.');
  });

  it('no le alcanza: se descuenta lo que hay y el RESTO queda para el siguiente', async () => {
    const { filas, aplicar } = montar([{ id: 'aj1', amount: -7.5 }]);
    const descontado = await aplicar(5);
    expect(descontado).toBe(5);
    expect(filas[0]).toMatchObject({ amount: -5, amountPaid: -5, paymentStatus: 'PAID' });
    const resto = filas[1];
    expect(resto).toMatchObject({
      amount: -2.5,
      paymentStatus: 'PENDING',
      status: 'ADJUSTMENT',
      periodKey: 'DEVOL-HP0032012122-c1-R1',
    });
    // La cadena suma lo que se debía.
    expect(filas.reduce((a, f) => a + f.amount, 0)).toBe(-7.5);
  });

  it('nunca deja el pago en negativo', async () => {
    const { aplicar } = montar([{ id: 'aj1', amount: -7.5 }, { id: 'aj2', amount: -3 }]);
    expect(await aplicar(9)).toBe(9);
  });

  it('sin nada que transferir, no se descuenta nada', async () => {
    const { filas, aplicar } = montar([{ id: 'aj1', amount: -7.5 }]);
    expect(await aplicar(0)).toBe(0);
    expect(filas[0].paymentStatus).toBe('PENDING');
  });

  it('revertir el pago devuelve el descuento a «por recuperar»', async () => {
    const { filas, aplicar, devolver } = montar([{ id: 'aj1', amount: -7.5 }]);
    await aplicar(30);
    const devuelto = await devolver();
    expect(devuelto).toBe(7.5);
    expect(filas[0]).toMatchObject({ paymentStatus: 'PENDING', amountPaid: 0, payoutBatchId: null, paidAt: null });
  });
});
