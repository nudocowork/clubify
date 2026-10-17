import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ReporteComisionesService } from './reporte-comisiones.service';
import { baseDelRango, socioDeContabilidad } from './socio-de-contabilidad';

/**
 * La parte del socio de Contabilidad se ENSEÑA en «Socios comerciales», pero
 * no se suma a nada: ya se le paga desde Contabilidad (bitácora 136). Si un
 * día entrara en el total, el cierre o el pendiente, se le pagaría dos veces.
 */

describe('base del socio según el rango', () => {
  it('hasta septiembre de 2026 es el bruto; desde octubre, el neto; cruzando, mixta', () => {
    expect(baseDelRango('2026-09-01', '2026-09-30', '2026-10-17')).toBe('BRUTO');
    expect(baseDelRango('2026-10-01', '2026-10-31', '2026-10-17')).toBe('NETO');
    expect(baseDelRango('2026-09-15', '2026-10-15', '2026-10-17')).toBe('MIXTA');
    // Sin «desde» empieza en el pasado; sin «hasta», llega a hoy.
    expect(baseDelRango(undefined, undefined, '2026-10-17')).toBe('MIXTA');
    expect(baseDelRango('2026-10-05', undefined, '2026-10-17')).toBe('NETO');
  });

  it('aplica el % sobre la base que llega de Contabilidad', () => {
    const s = socioDeContabilidad({ baseUsd: 1234.5, porcentaje: 10, desde: '2026-10-01', hasta: '2026-10-31', hoy: '2026-10-17' });
    expect(s.montoUsd).toBe(123.45);
    expect(s.nombre).toBe('Socio (Javier)');
    expect(s.nota).toContain('no es una comisión del corte');
    expect(s.informativo).toBe(true);
  });
});

function servicio(baseDelSocioUsd: number) {
  const comision = {
    id: 'c1',
    status: 'APPROVED',
    paymentStatus: 'PENDING',
    amount: new Prisma.Decimal(40),
    amountPaid: new Prisma.Decimal(0),
    payoutBatchId: null,
    recipientCodeId: 'soc',
    recipientCode: { id: 'soc', ownerName: 'Socio viejo', role: 'SOCIO' },
    referralUse: null,
    businessGroup: null,
    payoutBatch: null,
    periodKey: '2026-10',
    businessDate: new Date('2026-10-05T15:00:00Z'),
    createdAt: new Date('2026-10-05T15:00:00Z'),
    baseAmountUsd: null,
    appliedPercent: null,
    notes: null,
  };
  const prisma: any = {
    whiteLabel: { findFirst: async () => ({ id: 'wl-clubify' }) },
    setting: { findMany: async () => [], findUnique: async () => null },
    commission: { findMany: async () => [comision] },
    salesTeamMember: { findMany: async () => [] },
    referralCode: { findMany: async () => [] },
    incomeRecord: { aggregate: async () => ({ _sum: { grossUsd: new Prisma.Decimal(5000) }, _count: { _all: 3 } }) },
  };
  const income = { summary: vi.fn(async () => ({ baseDelSocioUsd })) };
  return { svc: new ReporteComisionesService(prisma, {} as any, {} as any, income as any), income };
}

describe('el socio de Contabilidad en el resumen', () => {
  const f = { desde: '2026-10-01', hasta: '2026-10-31' };

  it('aparece como línea informativa con monto, % y base', async () => {
    const { svc, income } = servicio(2000);
    const r = await svc.resumen(f);
    expect(income.summary).toHaveBeenCalledWith(expect.objectContaining({ onlyClubify: true }));
    expect(r.socioContabilidad).toMatchObject({
      nombre: 'Socio (Javier)',
      montoUsd: 200,
      porcentaje: 10,
      baseUsd: 2000,
      base: 'NETO',
      informativo: true,
    });
  });

  it('no cambia el total general, el de Socios comerciales ni el cuadre', async () => {
    const sin = await servicio(0).svc.resumen(f);
    const con = await servicio(2000).svc.resumen(f);
    expect(con.socioContabilidad?.montoUsd).toBe(200);
    expect(con.general).toEqual(sin.general);
    expect(con.porEquipo).toEqual(sin.porEquipo);
    expect(con.cuadre).toEqual(sin.cuadre);
    // Solo la comisión real (40) está en el total: los 200 del socio, no.
    expect(con.general.comisionesUsd).toBe(40);
    expect(con.porEquipo.SOCIOS.comisionesUsd).toBe(40);
  });

  it('con filtro de colaborador u otro equipo no se muestra', async () => {
    const { svc } = servicio(2000);
    expect((await svc.resumen({ ...f, colaborador: 'ana' })).socioContabilidad).toBeNull();
    expect((await svc.resumen({ ...f, equipo: 'CLOSERS' })).socioContabilidad).toBeNull();
    expect((await svc.resumen({ ...f, equipo: 'SOCIOS' })).socioContabilidad).not.toBeNull();
  });
});
