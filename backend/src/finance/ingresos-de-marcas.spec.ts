import { describe, it, expect, beforeEach } from 'vitest';
import { compararMarcas, conceptoDelIngreso, cuentaDeLaVenta, fechaDeCuota } from './ingresos-de-marcas';
import { IngresosDeMarcasService } from './ingresos-de-marcas.service';
import { olvidarMarcaClubify } from './alcance-de-marca';

/**
 * «Marcas blancas» (Sara, 2026-10-03): lo que cada marca blanca le paga a la
 * plataforma —rebranding, créditos, servicios— es ingreso de Clubify, y hay que
 * poder ver cuál ingresa más.
 */

beforeEach(() => olvidarMarcaClubify());
const d = (s: string) => new Date(`${s}T17:00:00Z`);

describe('qué es cada pago de una marca', () => {
  it('lo que llegó como compra de créditos por Hotmart es CRÉDITOS', () => {
    expect(conceptoDelIngreso({ externalTxId: 'HP1', productName: '20 USD', esCompraDeCreditos: true })).toBe('CREDITOS');
  });
  it('lo registrado a mano lleva su concepto en el nombre', () => {
    expect(conceptoDelIngreso({ externalTxId: 'marca-1', productName: 'Rebranding', esCompraDeCreditos: false })).toBe('REBRANDING');
    expect(conceptoDelIngreso({ externalTxId: 'marca-2', productName: 'Servicio: Automatización de WhatsApp', esCompraDeCreditos: false })).toBe('SERVICIO');
    expect(conceptoDelIngreso({ externalTxId: 'HP9', productName: 'CLUBIFY - TARJETAS', esCompraDeCreditos: false })).toBe('OTRO');
  });
});

describe('comparar marcas', () => {
  it('suma por marca y concepto, ordena de mayor a menor y da la participación', () => {
    const r = compararMarcas(
      [
        { payerWhiteLabelId: 'sellea', grossUsd: 1200, saleDate: d('2026-06-01'), concepto: 'REBRANDING' },
        { payerWhiteLabelId: 'sellea', grossUsd: 300, saleDate: d('2026-08-01'), concepto: 'CREDITOS' },
        { payerWhiteLabelId: 'fideliso', grossUsd: 500, saleDate: d('2026-07-01'), concepto: 'CREDITOS' },
      ],
      ['fideliso', 'sellea', 'sin-pagos'],
    );
    expect(r.map((m) => m.whiteLabelId)).toEqual(['sellea', 'fideliso', 'sin-pagos']);
    expect(r[0]).toMatchObject({ totalUsd: 1500, pagos: 2, participacion: 75, porConcepto: { REBRANDING: 1200, CREDITOS: 300 } });
    expect(r[0].ultimoPago).toEqual(d('2026-08-01'));
    // Una marca sin pagos sale igual, en cero: también es información.
    expect(r[2]).toMatchObject({ totalUsd: 0, pagos: 0, participacion: 0 });
  });
});

describe('registrar un pago de una marca', () => {
  function montar() {
    const creadas: any[] = [];
    const prisma: any = {
      whiteLabel: {
        findFirst: async () => ({ id: 'wl-clubify' }),
        findMany: async () => [{ id: 'sellea', name: 'Sellea', slug: 'sellea', logoUrl: null, createdAt: d('2026-05-01') }],
      },
      user: { findUnique: async () => ({ fullName: 'Sara Plata', email: 'x' }) },
      setting: { findUnique: async () => null },
      incomeRecord: { create: async ({ data }: any) => (creadas.push(data), { id: 'f1', grossUsd: data.grossUsd, saleDate: data.saleDate }) },
    };
    const income: any = { desglose: async (_g: string, m: number) => ({ fee: 0, tax: 0, netExpected: m }) };
    return { svc: new IngresosDeMarcasService(prisma, income), creadas };
  }

  it('entra al libro como ingreso de Clubify, pagado por la marca', async () => {
    const { svc, creadas } = montar();
    await svc.registrar({ whiteLabelId: 'sellea', concepto: 'rebranding', montoUsd: '1200', fecha: '2026-06-01', metodo: 'transferencia' }, 'admin');
    expect(creadas[0]).toMatchObject({
      whiteLabelId: 'wl-clubify',
      payerWhiteLabelId: 'sellea',
      tenantId: null,
      category: 'MARCA_BLANCA',
      productName: 'Compra marca blanca',
      status: 'PAGADO',
      grossUsd: 1200,
      gateway: 'MANUAL',
      brandName: 'Sellea (marca blanca)',
    });
    expect(creadas[0].externalTxId).toMatch(/^marca-/);
    expect(creadas[0].note).toContain('Sara Plata');
  });

  it('sin marca, sin concepto, sin monto o con fecha futura no registra', async () => {
    const { svc, creadas } = montar();
    await expect(svc.registrar({ concepto: 'REBRANDING', montoUsd: 10 }, 'a')).rejects.toThrow(/marca/);
    await expect(svc.registrar({ whiteLabelId: 'sellea', concepto: 'X', montoUsd: 10 }, 'a')).rejects.toThrow(/concepto/);
    await expect(svc.registrar({ whiteLabelId: 'sellea', concepto: 'CREDITOS', montoUsd: '0' }, 'a')).rejects.toThrow(/monto/);
    await expect(svc.registrar({ whiteLabelId: 'sellea', concepto: 'CREDITOS', montoUsd: 5, fecha: '2099-01-01' }, 'a')).rejects.toThrow(/futura/);
    expect(creadas).toHaveLength(0);
  });
});

describe('lo que NO es ingreso de Clubify (Sara, 2026-10-06)', () => {
  it('un servicio (automatización de WhatsApp) queda registrado como INTERMEDIADO', async () => {
    const creadas: any[] = [];
    const prisma: any = {
      whiteLabel: {
        findFirst: async () => ({ id: 'wl-clubify' }),
        findMany: async () => [{ id: 'sellea', name: 'Sellea', slug: 'sellea', logoUrl: null, createdAt: d('2026-05-01') }],
      },
      user: { findUnique: async () => null },
      setting: { findUnique: async () => null },
      incomeRecord: { create: async ({ data }: any) => (creadas.push(data), { id: 'f', grossUsd: data.grossUsd, saleDate: data.saleDate }) },
    };
    const svc = new IngresosDeMarcasService(prisma, { desglose: async (_g: string, m: number) => ({ fee: 0, tax: 0, netExpected: m }) } as any);
    await svc.registrar({ whiteLabelId: 'sellea', concepto: 'SERVICIO', descripcion: 'Automatización de WhatsApp', montoUsd: 99.03 }, 'a');
    await svc.registrar({ whiteLabelId: 'sellea', concepto: 'CREDITOS', montoUsd: 50 }, 'a');
    expect(creadas[0]).toMatchObject({ status: 'INTERMEDIADO', productName: 'Servicio: Automatización de WhatsApp' });
    expect(creadas[1].status).toBe('PAGADO');
  });

  it('el nombre viejo «Rebranding» sigue siendo la compra de la marca', () => {
    expect(conceptoDelIngreso({ externalTxId: 'marca-1', productName: 'Compra marca blanca', esCompraDeCreditos: false })).toBe('REBRANDING');
  });
});

describe('la venta de una marca blanca en cuotas', () => {
  const hoy = d('2026-10-07');
  const base = { totalUsd: 1200, cuotas: 4, frecuencia: 'MENSUAL' as const, primeraCuota: d('2026-08-31'), estado: 'ACTIVA' as const };

  it('cuenta las cuotas por dinero y da la siguiente fecha', () => {
    const c = cuentaDeLaVenta(base, [300, 300], hoy);
    expect(c).toMatchObject({ pagadoUsd: 600, faltaUsd: 600, montoCuotaUsd: 300, cuotasPagadas: 2 });
    // 31 de agosto + 2 meses = 31 de octubre; aún no vence.
    expect(c.proximaCuota).toEqual(d('2026-10-31'));
    expect(c.vencida).toBe(false);
  });

  it('media cuota no es una cuota, y el fin de mes se respeta', () => {
    const c = cuentaDeLaVenta(base, [450], hoy);
    expect(c.cuotasPagadas).toBe(1);
    expect(c.proximaCuota).toEqual(d('2026-09-30'));
    expect(c.vencida).toBe(true);
    expect(fechaDeCuota(d('2026-01-31'), 'MENSUAL', 1)).toEqual(d('2026-02-28'));
    expect(fechaDeCuota(d('2026-10-01'), 'QUINCENAL', 2)).toEqual(d('2026-10-31'));
  });

  it('pausada (Fideliso): lo pagado cuenta, pero no se espera cuota; sin total no hay «falta»', () => {
    const c = cuentaDeLaVenta({ ...base, totalUsd: null, estado: 'PAUSADA' }, [200], hoy);
    expect(c).toMatchObject({ pagadoUsd: 200, faltaUsd: null, proximaCuota: null, vencida: false });
  });

  it('pagada del todo: no queda nada ni próxima cuota', () => {
    const c = cuentaDeLaVenta(base, [1200], hoy);
    expect(c).toMatchObject({ faltaUsd: 0, cuotasPagadas: 4, proximaCuota: null });
  });
});
