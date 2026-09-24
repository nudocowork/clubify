import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { FinanceReportService } from './finance-report.service';

/**
 * Los dos puntos que quedaban del encargo de Sara (PDF del 17-09-2026).
 *
 * 1. «se generaron dos periodos con la misma fecha en lugar de poder agregar
 *    únicamente al colaborador faltante».
 * 2. «cuando las comisiones se marquen como pagadas en su módulo respectivo y
 *    se anexen los respectivos comprobantes, se debe registrar en contabilidad».
 */

// ── 1. Dos cortes de nómina del mismo período ───────────────────────────────

function nomina(gemelo: { id: string; periodLabel: string } | null) {
  const creados: any[] = [];
  const prisma: any = {
    payrollRun: {
      findFirst: async () => gemelo,
      create: async ({ data }: any) => {
        creados.push(data);
        return { id: 'r1', ...data };
      },
    },
  };
  return { svc: new PayrollService(prisma), creados };
}

const CORTE = {
  periodLabel: 'Quincena 1-15 sep 2026',
  periodStart: '2026-09-01T12:00:00.000Z',
  periodEnd: '2026-09-15T12:00:00.000Z',
  items: [{ employeeName: 'Sara Plata', baseUsd: 256 }],
};

describe('generar el mismo período dos veces', () => {
  it('con un corte sin pagos, se rechaza y se dice qué hacer', async () => {
    const { svc, creados } = nomina({ id: 'r-viejo', periodLabel: 'Quincena 1-15 sep 2026' });
    await expect(svc.generateRun(CORTE as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(creados).toEqual([]);
  });

  it('el mensaje nombra el corte que ya existe', async () => {
    const { svc } = nomina({ id: 'r-viejo', periodLabel: 'Quincena 1-15 sep 2026' });
    await expect(svc.generateRun(CORTE as any)).rejects.toThrow(/Quincena 1-15 sep 2026/);
  });

  it('si el corte que existe YA tiene pagos, se deja generar otro', async () => {
    // Es la salida correcta del encargo: corte nuevo, misma fecha, solo los que
    // faltan. `findFirst` no lo encuentra porque filtra por `amountPaidUsd <= 0`.
    const { svc, creados } = nomina(null);
    await svc.generateRun(CORTE as any);
    expect(creados).toHaveLength(1);
    expect(creados[0].periodLabel).toBe('Quincena 1-15 sep 2026');
  });

  it('sin fecha de fin no se estorba a nadie', async () => {
    const { svc, creados } = nomina(null);
    await svc.generateRun({ ...CORTE, periodEnd: null } as any);
    expect(creados).toHaveLength(1);
  });
});

// ── 2. El comprobante de cada transferencia, dentro de Contabilidad ─────────

function contabilidad(pagos: any[]) {
  const prisma: any = {
    payoutBatch: {
      findMany: async () => [
        {
          id: 'b1',
          code: 'CORTE-2026-09-15',
          cutoffDate: new Date('2026-09-15T00:00:00Z'),
          periodStart: new Date('2026-09-01T00:00:00Z'),
          periodEnd: new Date('2026-09-15T00:00:00Z'),
          status: 'OPEN',
          paymentDate: null,
          receivedAt: null,
          commissions: [
            {
              amount: 160,
              amountPaid: 160,
              recipientCodeId: 'rc-rojas',
              recipientCode: { code: 'ROJAS', ownerName: 'Nicolas Rojas', role: 'INFLUENCER' },
            },
            {
              amount: 25,
              amountPaid: 0,
              recipientCodeId: 'rc-samu',
              recipientCode: { code: 'SAMU', ownerName: 'Samuel Navarro', role: 'VENDOR' },
            },
          ],
        },
      ],
    },
    commission: { findMany: async () => [] },
    batchPersonPayment: { findMany: async () => pagos },
  };
  return new FinanceReportService(prisma, {} as any, {} as any);
}

const PAGO = {
  batchId: 'b1',
  recipientCodeId: 'rc-rojas',
  proofUrl: 'https://r2/comprobante-rojas.pdf',
  reference: 'NEQUI-8891',
  paidAt: new Date('2026-09-16T15:00:00Z'),
};

describe('el comprobante de la transferencia se ve en Contabilidad', () => {
  it('a quien se le pagó, con su comprobante y su referencia', async () => {
    const r: any = await contabilidad([PAGO]).cortesDeComisiones('2026-09');
    const rojas = r.cortes[0].personas.find((p: any) => p.nombre === 'Nicolas Rojas');
    expect(rojas.comprobanteUrl).toBe('https://r2/comprobante-rojas.pdf');
    expect(rojas.referencia).toBe('NEQUI-8891');
    expect(rojas.pagadoEl?.toISOString()).toBe('2026-09-16T15:00:00.000Z');
  });

  it('a quien NO se le ha pagado, en blanco — no se hereda el de otro', async () => {
    const r: any = await contabilidad([PAGO]).cortesDeComisiones('2026-09');
    const samu = r.cortes[0].personas.find((p: any) => p.nombre === 'Samuel Navarro');
    expect(samu.comprobanteUrl).toBeNull();
    expect(samu.pagadoEl).toBeNull();
  });

  it('sin comprobantes cargados, el corte sigue saliendo igual', async () => {
    const r: any = await contabilidad([]).cortesDeComisiones('2026-09');
    expect(r.cortes[0].totalUsd).toBe(185);
    expect(r.cortes[0].personas).toHaveLength(2);
  });

  it('el corte llega con su número y sus fechas de inicio y fin', async () => {
    // «corte …. (número de corte con fecha respectiva de inicio y final)».
    const r: any = await contabilidad([]).cortesDeComisiones('2026-09');
    expect(r.cortes[0].code).toBe('CORTE-2026-09-15');
    expect(r.cortes[0].periodStart?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(r.cortes[0].periodEnd?.toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });
});
