import { describe, it, expect, beforeEach } from 'vitest';
import { ComisionDeEquipoService, comisionDeLaQuincena } from './comision-de-equipo.service';
import { olvidarMarcaClubify } from '../finance/alcance-de-marca';

/**
 * Comisión de equipo (Javier, 2026-10-02): Sara Plata, Project Manager, cobra
 * el 2 % de TODAS las ventas de cada quincena, tomadas de Contabilidad, sin
 * espera de 15 días, y se ajusta sola si cambia un ingreso.
 */

const SARA = 'code-sara';
const HOY = new Date('2026-10-02T15:00:00Z');

function base(opts: {
  ajustes?: Record<string, string>;
  ingresos?: Array<{ saleDate: Date; grossUsd: number; status?: string }>;
  lotes?: any[];
} = {}) {
  const ajustes = { 'comisiones.equipo.codeId': SARA, ...(opts.ajustes ?? {}) };
  const ingresos = opts.ingresos ?? [];
  const comisiones: any[] = [];
  const lotes = opts.lotes ?? [
    { id: 'b-sep30', code: 'CORTE-2026-09-30', status: 'OPEN', totalUsd: 0 },
  ];
  const enRango = (d: Date, w: any) =>
    (!w.gte || d >= w.gte) && (!w.lt || d < w.lt) && (!w.lte || d <= w.lte);
  // El `where` llega envuelto por `combinar()` (AND de fragmentos).
  const aplanar = (w: any): any[] => (w?.AND ? w.AND.flatMap(aplanar) : [w]);
  const prisma: any = {
    setting: {
      findUnique: async ({ where }: any) =>
        ajustes[where.key as keyof typeof ajustes] != null ? { value: ajustes[where.key as keyof typeof ajustes] } : null,
    },
    whiteLabel: { findFirst: async () => ({ id: 'wl-clubify' }) },
    referralCode: {
      findUnique: async ({ where }: any) =>
        where.id === SARA ? { id: SARA, ownerName: 'Sara Plata', isActive: true } : null,
    },
    incomeRecord: {
      aggregate: async ({ where }: any) => {
        const partes = aplanar(where);
        const rango = partes.find((p) => p.saleDate)?.saleDate;
        const suma = ingresos
          .filter((i) => (i.status ?? 'PAGADO') === 'PAGADO' && enRango(i.saleDate, rango))
          .reduce((a, i) => a + i.grossUsd, 0);
        return { _sum: { grossUsd: suma } };
      },
    },
    payoutBatch: {
      findUnique: async ({ where }: any) => lotes.find((l) => l.code === where.code) ?? null,
      update: async ({ where, data }: any) => Object.assign(lotes.find((l) => l.id === where.id), data),
    },
    commission: {
      findFirst: async ({ where }: any) =>
        comisiones.find((c) => c.recipientCodeId === where.recipientCodeId && c.periodKey === where.periodKey) ?? null,
      create: async ({ data }: any) => {
        const c = { id: `c${comisiones.length}`, ...data };
        comisiones.push(c);
        return c;
      },
      updateMany: async ({ where, data }: any) => {
        const c = comisiones.find((x) => x.id === where.id && x.paymentStatus === 'PENDING' && Number(x.amountPaid) === 0);
        if (c) Object.assign(c, data);
        return { count: c ? 1 : 0 };
      },
      aggregate: async ({ where }: any) => ({
        _sum: {
          amount: comisiones
            .filter((c) => c.payoutBatchId === where.payoutBatchId && c.status !== 'REJECTED')
            .reduce((a, c) => a + Number(c.amount), 0),
        },
      }),
    },
  };
  return { svc: new ComisionDeEquipoService(prisma), comisiones, lotes, ingresos };
}

beforeEach(() => olvidarMarcaClubify());

describe('comisión de equipo (2 % de las ventas de la quincena)', () => {
  it('el cálculo: % del total, nunca negativo', () => {
    expect(comisionDeLaQuincena(5000, 2)).toBe(100);
    expect(comisionDeLaQuincena(-10, 2)).toBe(0);
  });

  it('la quincena del 16 al 30-sep paga el 2 % de lo ingresado del 16 al 30', async () => {
    const { svc, comisiones } = base({
      ingresos: [
        { saleDate: new Date('2026-09-10T15:00:00Z'), grossUsd: 1000 }, // 1ª quincena: no cuenta
        { saleDate: new Date('2026-09-16T15:00:00Z'), grossUsd: 150 },
        { saleDate: new Date('2026-09-30T22:00:00Z'), grossUsd: 350 }, // 30-sep 5 pm Bogotá
        { saleDate: new Date('2026-10-01T06:00:00Z'), grossUsd: 68 }, // 1-oct Bogotá: es de octubre
        { saleDate: new Date('2026-09-20T15:00:00Z'), grossUsd: 500, status: 'REEMBOLSADO' },
      ],
    });
    await svc.recalcular(HOY);
    const sep = comisiones.find((c) => c.periodKey === 'EQUIPO-2026-09-30');
    expect(sep).toMatchObject({
      recipientCodeId: SARA,
      amount: 10, // 2 % de 500
      status: 'APPROVED', // sin los 15 días de espera
      baseAmountUsd: 500,
      payoutBatchId: 'b-sep30',
    });
  });

  it('si entra o se corrige un ingreso, la comisión no pagada se recalcula', async () => {
    const { svc, comisiones, ingresos } = base({
      ingresos: [{ saleDate: new Date('2026-09-20T15:00:00Z'), grossUsd: 500 }],
    });
    await svc.recalcular(HOY);
    ingresos.push({ saleDate: new Date('2026-09-25T15:00:00Z'), grossUsd: 150 });
    await svc.recalcular(HOY);
    const sep = comisiones.filter((c) => c.periodKey === 'EQUIPO-2026-09-30');
    expect(sep).toHaveLength(1); // no duplica
    expect(sep[0].amount).toBe(13);
  });

  it('una ya pagada no se reescribe', async () => {
    const { svc, comisiones, ingresos } = base({
      ingresos: [{ saleDate: new Date('2026-09-20T15:00:00Z'), grossUsd: 500 }],
    });
    await svc.recalcular(HOY);
    Object.assign(comisiones[0], { paymentStatus: 'PAID', amountPaid: 10 });
    ingresos.push({ saleDate: new Date('2026-09-25T15:00:00Z'), grossUsd: 150 });
    await svc.recalcular(HOY);
    expect(comisiones[0].amount).toBe(10);
  });

  it('empieza en la quincena configurada: la del 1 al 15-sep no paga', async () => {
    const { svc, comisiones } = base({
      ingresos: [{ saleDate: new Date('2026-09-10T15:00:00Z'), grossUsd: 1000 }],
    });
    await svc.recalcular(HOY);
    expect(comisiones.find((c) => c.periodKey === 'EQUIPO-2026-09-15')).toBeUndefined();
  });

  it('sin código configurado no hace nada', async () => {
    const { svc, comisiones } = base({ ajustes: { 'comisiones.equipo.codeId': '' } });
    const r = await svc.recalcular(HOY);
    expect(r.activa).toBe(false);
    expect(comisiones).toHaveLength(0);
  });

  it('la quincena EN CURSO queda en espera y fuera de todo corte hasta su día', async () => {
    // Sara (2026-10-03): la del 1–15 de octubre apareció en el corte del 30-sep.
    const { svc, comisiones } = base({
      ingresos: [{ saleDate: new Date('2026-10-01T15:00:00Z'), grossUsd: 368 }],
    });
    await svc.recalcular(HOY);
    const oct = comisiones.find((c) => c.periodKey === 'EQUIPO-2026-10-15');
    expect(oct).toMatchObject({ status: 'PENDING', amount: 7.36 });
    expect(oct.payoutBatchId).toBeUndefined();
  });

  it('si ya estaba metida en un corte ajeno, la saca y ese corte recalcula su total', async () => {
    const { svc, comisiones, lotes } = base({
      ingresos: [{ saleDate: new Date('2026-10-01T15:00:00Z'), grossUsd: 368 }],
    });
    comisiones.push({
      id: 'vieja', recipientCodeId: SARA, periodKey: 'EQUIPO-2026-10-15', amount: 7.36,
      status: 'APPROVED', paymentStatus: 'PENDING', amountPaid: 0, payoutBatchId: 'b-sep30',
    });
    lotes[0].totalUsd = 7.36;
    await svc.recalcular(HOY);
    const oct = comisiones.find((c) => c.id === 'vieja');
    expect(oct).toMatchObject({ status: 'PENDING', payoutBatchId: null });
    expect(lotes[0].totalUsd).toBe(0);
  });

  it('el día de su corte se aprueba y entra a ESE corte', async () => {
    const { svc, comisiones } = base({
      lotes: [{ id: 'b-oct15', code: 'CORTE-2026-10-15', status: 'OPEN', totalUsd: 0 }],
      ingresos: [{ saleDate: new Date('2026-10-01T15:00:00Z'), grossUsd: 368 }],
    });
    await svc.recalcular(new Date('2026-10-15T15:00:00Z'));
    const oct = comisiones.find((c) => c.periodKey === 'EQUIPO-2026-10-15');
    expect(oct).toMatchObject({ status: 'APPROVED', payoutBatchId: 'b-oct15' });
  });

  it('el porcentaje es un ajuste', async () => {
    const { svc, comisiones } = base({
      ajustes: { 'comisiones.equipo.porcentaje': '3' },
      ingresos: [{ saleDate: new Date('2026-09-20T15:00:00Z'), grossUsd: 500 }],
    });
    await svc.recalcular(HOY);
    expect(comisiones[0].amount).toBe(15);
  });
});
