import { describe, it, expect } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { CutoffService } from './cutoff.service';

/**
 * PAUSAR A UNA PERSONA EN UN CORTE (Javier, 2026-10-01)
 *
 * En el corte del 1 al 15 de septiembre a Nicolás Rojas se le deben unas
 * comisiones que se le pagarán más adelante, y el corte no se podía cerrar:
 * el cierre exige a todas las personas pagadas. «Pausar» pasa sus comisiones
 * sin pagar al corte siguiente.
 */

const ADMIN = { id: 'admin-1', role: 'SUPER_ADMIN' } as any;

type Comision = {
  id: string;
  amount: number;
  amountPaid: number;
  status: string;
  paymentStatus: string;
  payoutBatchId: string | null;
  recipientCodeId: string | null;
  notes: string | null;
};

function coincide(valor: any, cond: any): boolean {
  if (cond === undefined) return true;
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('in' in cond) return (cond.in as any[]).includes(valor);
    if ('not' in cond) return cond.not === null ? valor !== null : valor !== cond.not;
  }
  return valor === cond;
}
const cumple = (c: any, where: any) =>
  Object.entries(where).every(([k, v]) => coincide(c[k], v));

function montar(comisiones: Comision[], lotes: any[]) {
  const coms = new Map(comisiones.map((c) => [c.id, { ...c }]));
  const lotesPorId = new Map(lotes.map((l) => [l.id, { ...l }]));
  const alertas: string[] = [];
  const auditoria: any[] = [];
  let nuevos = 0;
  const prisma: any = {
    payoutBatch: {
      findUnique: async ({ where }: any) =>
        where.id
          ? lotesPorId.get(where.id) ?? null
          : [...lotesPorId.values()].find((l) => l.code === where.code) ?? null,
      findUniqueOrThrow: async ({ where }: any) =>
        [...lotesPorId.values()].find((l) => l.code === where.code),
      create: async ({ data }: any) => {
        const l = { id: `nuevo-${++nuevos}`, ...data };
        lotesPorId.set(l.id, l);
        return l;
      },
      update: async ({ where, data }: any) => Object.assign(lotesPorId.get(where.id), data),
    },
    commission: {
      findMany: async ({ where }: any) => [...coms.values()].filter((c) => cumple(c, where)),
      updateMany: async ({ where, data }: any) => {
        const tocadas = [...coms.values()].filter((c) => cumple(c, where));
        for (const c of tocadas) Object.assign(c, data);
        return { count: tocadas.length };
      },
      aggregate: async ({ where }: any) => ({
        _sum: {
          amount: [...coms.values()]
            .filter((c) => c.payoutBatchId === where.payoutBatchId && c.status !== 'REJECTED')
            .reduce((a, c) => a + c.amount, 0),
        },
      }),
    },
    batchPersonPayment: { findMany: async () => [] },
    referralCode: { findUnique: async () => ({ ownerName: 'Nicolas Rojas' }) },
    $transaction: async (fn: any) => fn(prisma),
  };
  const svc = new CutoffService(
    prisma,
    { log: async (a: any) => auditoria.push(a) } as any,
    {} as any,
    { sendInternalAlert: async (_t: string, m: string) => alertas.push(m) } as any,
  );
  return { svc, coms, lotesPorId, alertas, auditoria };
}

const comision = (p: Partial<Comision> & { id: string }): Comision => ({
  amount: 40,
  amountPaid: 0,
  status: 'APPROVED',
  paymentStatus: 'PENDING',
  payoutBatchId: 'Q1',
  recipientCodeId: 'nicolas',
  notes: null,
  ...p,
});

const Q1 = {
  id: 'Q1',
  code: 'CORTE-2026-09-15',
  status: 'OPEN',
  cutoffDate: new Date('2026-09-15T17:00:00Z'),
  totalUsd: 160,
  receivedAt: new Date('2026-09-16T15:00:00Z'),
};
const Q2 = {
  id: 'Q2',
  code: 'CORTE-2026-09-30',
  status: 'OPEN',
  cutoffDate: new Date('2026-09-30T17:00:00Z'),
  totalUsd: 0,
};

describe('pausar a una persona en el corte', () => {
  it('sus comisiones sin pagar pasan al corte siguiente, con la nota de dónde venían', async () => {
    const { svc, coms, lotesPorId } = montar(
      [
        comision({ id: 'a', amount: 60 }),
        comision({ id: 'b', amount: 100 }),
        comision({ id: 'otra', recipientCodeId: 'otra-persona', amount: 25 }),
      ],
      [Q1, Q2],
    );
    const r = await svc.pausePerson(ADMIN, 'Q1', 'nicolas', { motivo: 'se le paga después' });
    expect(r).toMatchObject({ count: 2, amountUsd: 160, toCode: 'CORTE-2026-09-30' });
    expect(coms.get('a')!.payoutBatchId).toBe('Q2');
    expect(coms.get('b')!.payoutBatchId).toBe('Q2');
    // Siguen aprobadas: se pagan en el corte nuevo por el camino de siempre.
    expect(coms.get('a')!.status).toBe('APPROVED');
    expect(coms.get('a')!.notes).toContain('Pausada en CORTE-2026-09-15: pasa a CORTE-2026-09-30');
    // La de otra persona no se toca.
    expect(coms.get('otra')!.payoutBatchId).toBe('Q1');
    // Los dos totales se recalculan.
    expect(lotesPorId.get('Q1')!.totalUsd).toBe(25);
    expect(lotesPorId.get('Q2')!.totalUsd).toBe(160);
  });

  it('después de pausar, el corte se puede cerrar sin esa persona', async () => {
    const { svc } = montar(
      [
        comision({ id: 'a' }),
        comision({ id: 'pagada', recipientCodeId: 'otra', amountPaid: 25, amount: 25, status: 'PAID', paymentStatus: 'PAID' }),
      ],
      [Q1, Q2],
    );
    expect((await svc.batchPayoutStatus(ADMIN, 'Q1')).canClose).toBe(false);
    await svc.pausePerson(ADMIN, 'Q1', 'nicolas');
    expect((await svc.batchPayoutStatus(ADMIN, 'Q1')).canClose).toBe(true);
  });

  it('si pausar deja el corte vacío, se puede cerrar en $0', async () => {
    const { svc } = montar([comision({ id: 'a' })], [{ ...Q1, receivedAt: null }, Q2]);
    await svc.pausePerson(ADMIN, 'Q1', 'nicolas');
    const st = await svc.batchPayoutStatus(ADMIN, 'Q1');
    expect(st.people).toHaveLength(0);
    expect(st.canClose).toBe(true);
  });

  it('si el corte siguiente todavía no existe, se crea VACÍO y van ahí', async () => {
    const { svc, coms, lotesPorId } = montar([comision({ id: 'a' })], [Q1]);
    const r = await svc.pausePerson(ADMIN, 'Q1', 'nicolas');
    expect(r.toCode).toBe('CORTE-2026-09-30');
    const nuevo = [...lotesPorId.values()].find((l) => l.code === 'CORTE-2026-09-30');
    expect(nuevo.status).toBe('OPEN');
    expect(coms.get('a')!.payoutBatchId).toBe(nuevo.id);
  });

  it('si el siguiente ya está CERRADO, salta al próximo abierto', async () => {
    const { svc } = montar([comision({ id: 'a' })], [Q1, { ...Q2, status: 'CLOSED' }]);
    const r = await svc.pausePerson(ADMIN, 'Q1', 'nicolas');
    expect(r.toCode).toBe('CORTE-2026-10-15');
  });

  it('con un pago parcial no se pausa: ese dinero ya es de este corte', async () => {
    const { svc, coms } = montar(
      [comision({ id: 'a', amount: 60, amountPaid: 20, paymentStatus: 'PARTIAL' })],
      [Q1, Q2],
    );
    await expect(svc.pausePerson(ADMIN, 'Q1', 'nicolas')).rejects.toBeInstanceOf(BadRequestException);
    expect(coms.get('a')!.payoutBatchId).toBe('Q1');
  });

  it('en un corte cerrado no se puede pausar', async () => {
    const { svc } = montar([comision({ id: 'a' })], [{ ...Q1, status: 'CLOSED' }, Q2]);
    await expect(svc.pausePerson(ADMIN, 'Q1', 'nicolas')).rejects.toBeInstanceOf(ConflictException);
  });

  it('deja rastro: auditoría y aviso interno', async () => {
    const { svc, auditoria, alertas } = montar([comision({ id: 'a' })], [Q1, Q2]);
    await svc.pausePerson(ADMIN, 'Q1', 'nicolas');
    expect(auditoria[0]).toMatchObject({ action: 'commission.person_paused' });
    expect(alertas[0]).toContain('pausado Nicolas Rojas');
  });
});
