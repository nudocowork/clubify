import { describe, it, expect, beforeEach } from 'vitest';
import { IncomeRecordService } from './income-record.service';
import { olvidarMarcaClubify } from './alcance-de-marca';

/**
 * Sara (2026-10-03): «los pagos de Aldehir — Grupo Mística no se registraron en
 * Contabilidad». Estaban: a nombre del GRUPO. Buscándolos por un negocio
 * («Marea Místika») no salían. La lista lleva ahora los negocios de cada grupo
 * para que el buscador los encuentre por cualquiera de ellos.
 */

beforeEach(() => olvidarMarcaClubify());

const fila = (o: Record<string, unknown>) => ({
  id: 'r', gateway: 'HOTMART', externalTxId: 'HP1', tenantId: null, businessGroupId: null,
  brandName: null, grossUsd: 150, gatewayFeeUsd: 0, taxUsd: 0, otherDiscountUsd: 0,
  netExpectedUsd: 150, netReceivedUsd: null, saleDate: new Date('2026-09-17T15:00:00Z'), ...o,
});

describe('la lista de ingresos y los grupos', () => {
  it('un cobro de grupo trae los nombres de sus negocios; uno de negocio, ninguno', async () => {
    const prisma: any = {
      whiteLabel: { findFirst: async () => ({ id: 'wl-clubify' }) },
      incomeRecord: {
        findMany: async () => [
          fila({ id: 'g', businessGroupId: 'grupo-1', brandName: 'Aldehir - Grupo Mistika (grupo)' }),
          fila({ id: 't', externalTxId: 'HP2', tenantId: 't1', brandName: 'Wok Explosivo' }),
        ],
      },
      tenant: {
        findMany: async ({ where }: any) =>
          where.businessGroupId.in.includes('grupo-1')
            ? [
                { businessGroupId: 'grupo-1', brandName: 'Cevichería Marea Místika' },
                { businessGroupId: 'grupo-1', brandName: 'Jamarea - Restobar Marino' },
              ]
            : [],
      },
    };
    const filas = await new IncomeRecordService(prisma).list({ onlyClubify: true });
    expect(filas.find((f) => f.id === 'g')?.negociosDelGrupo).toEqual([
      'Cevichería Marea Místika',
      'Jamarea - Restobar Marino',
    ]);
    expect(filas.find((f) => f.id === 't')?.negociosDelGrupo).toEqual([]);
  });
});
