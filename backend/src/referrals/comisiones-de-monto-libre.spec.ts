/**
 * LA COMISIÓN DEL UPGRADE NO PUEDE CONTAMINAR AL RESTO.
 *
 * Tres sitios recalculan comisiones «desde la base del negocio». Para una fila
 * de monto libre (`UPG-…`, `IMPL-…`) eso es destruirla, y —lo peor— destruye
 * también a sus vecinas:
 *
 *   · el ARQUEO deduce la base con `max(baseAmountUsd)` de TODAS las filas del
 *     negocio → con un upgrade de 350 conviviendo con mensuales de 68, la base
 *     pasa a 350 y el arqueo declara mal TODAS las mensuales. Y «Corregir todo»
 *     se usa: 7 veces en 90 días.
 *   · `recalcTenantSplit` y `recalcForRecipientCode` hacen
 *     `amount = base_actual × pct` → después del upgrade la base es el precio
 *     del anual, y la comisión del upgrade pasa de $87,50 a $125.
 *
 * Aquí se ejercita el arqueo DE VERDAD (la clase real, con prisma simulado),
 * porque el fallo estaba en el código, no en una copia.
 */
import { describe, it, expect, vi } from 'vitest';
import { ReferralsService } from './referrals.service';
import { CommissionRecalcService } from './commission-recalc.service';
import {
  NO_ES_DEL_UPGRADE,
  esDeMontoLibre,
  esDelUpgrade,
} from './comisiones-de-monto-libre';

const SUPER = { id: 'admin-1', role: 'SUPER_ADMIN', whiteLabelId: null } as any;

/** Una comisión tal y como la lee el arqueo. */
const comision = (o: {
  id: string;
  amount: number;
  base: number | null;
  periodKey: string | null;
  status?: string;
}) => ({
  id: o.id,
  amount: o.amount,
  baseAmountUsd: o.base,
  status: o.status ?? 'PENDING',
  periodKey: o.periodKey,
  recipientCodeId: 'inf',
  createdAt: new Date('2028-02-01T00:00:00.000Z'),
  recipientCode: { ownerName: 'Ana', role: 'INFLUENCER', isActive: true },
  referralUse: {
    referralCodeId: 'inf',
    tenant: {
      id: 'neg-1',
      brandName: 'Birria León',
      deletedAt: null,
      planPeriodicity: 'ANUAL',
      // Después del upgrade, el precio del negocio es el del ANUAL. Es la
      // trampa: recalcular desde aquí convierte $17 en $125.
      subscriptionPriceUsd: null,
    },
  },
});

function arqueo(filas: any[]) {
  const svc = Object.create(ReferralsService.prototype) as any;
  svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  svc.prisma = {
    commission: { findMany: vi.fn(async () => filas) },
    setting: { findUnique: vi.fn(async () => null) }, // sin socio configurado
    referralCode: { findUnique: vi.fn(async () => null) },
  };
  svc.recalc = {
    // Sin base congelada el arqueo cae al precio del negocio: hoy, el anual.
    getCommissionBase: vi.fn(async () => 500),
  };
  // El reparto real (influencer al 25 %), que es lo que el arqueo llama.
  svc.computeExpectedCommissionRows = vi.fn(async (_tid: string, base: number) => ({
    rows: [
      { recipientCodeId: 'inf', vendorCodeId: null, amount: Math.round(base * 25) / 100, appliedPercent: 25 },
    ],
    chain: {},
    mode: 'DISCOUNT_FROM_INFLUENCER',
  }));
  return svc;
}

describe('el arqueo no reescribe las comisiones viejas por culpa de la del upgrade', () => {
  it('un negocio con dos mensuales y un upgrade: NINGUNA sale mal', async () => {
    // Antes: snapBases = [68, 68, 350] → base = 350 → esperado 87,50 para
    // TODAS, así que las dos mensuales de $17 salían WRONG_AMOUNT y «Corregir
    // todo» las subía a $87,50. Dinero inventado para el afiliado.
    const svc = arqueo([
      comision({ id: 'c1', amount: 17, base: 68, periodKey: '2028-01' }),
      comision({ id: 'c2', amount: 17, base: 68, periodKey: '2028-02' }),
      comision({ id: 'c3', amount: 87.5, base: 350, periodKey: 'UPG-2028-02-upg1' }),
    ]);

    const { summary, findings } = await svc.auditCommissions(SUPER);

    expect(summary.wrongAmount).toBe(0);
    expect(findings).toHaveLength(0);
  });

  it('la del upgrade se juzga contra SU base: si está mal, sale mal', async () => {
    // El arreglo no puede ser «no mirar nunca las de upgrade»: sobre 350 al
    // 25 % lo correcto son 87,50, y una de 120 sí es un error.
    const svc = arqueo([
      comision({ id: 'c1', amount: 17, base: 68, periodKey: '2028-01' }),
      comision({ id: 'c3', amount: 120, base: 350, periodKey: 'UPG-2028-02-upg1' }),
    ]);

    const { findings } = await svc.auditCommissions(SUPER);

    expect(findings).toHaveLength(1);
    expect(findings[0].commissionId).toBe('c3');
    expect(findings[0].expected).toBe(87.5);
  });

  it('la de IMPLEMENTACIÓN tampoco arrastra a las demás', async () => {
    const svc = arqueo([
      comision({ id: 'c1', amount: 17, base: 68, periodKey: '2028-01' }),
      comision({ id: 'c2', amount: 250, base: 1000, periodKey: 'IMPL-2028-01-x9' }),
    ]);

    const { summary } = await svc.auditCommissions(SUPER);

    expect(summary.wrongAmount).toBe(0);
  });

  it('una fila de monto libre SIN base congelada se deja en paz', async () => {
    // No se le puede calcular un esperado: el precio del plan no es su base.
    // Inventárselo es exactamente lo que convertía $17 en $125.
    const svc = arqueo([
      comision({ id: 'c3', amount: 87.5, base: null, periodKey: 'UPG-2028-02-upg1' }),
    ]);

    const { findings } = await svc.auditCommissions(SUPER);

    expect(findings).toHaveLength(0);
  });

  it('sin filas de monto libre, el arqueo sigue haciendo lo de siempre', async () => {
    // Red de no-regresión: el arreglo no puede apagar el arqueo normal.
    const svc = arqueo([
      comision({ id: 'c1', amount: 99, base: 68, periodKey: '2028-01' }),
    ]);

    const { findings } = await svc.auditCommissions(SUPER);

    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('WRONG_AMOUNT');
    expect(findings[0].expected).toBe(17);
  });
});

describe('«corregir» una fila de upgrade se niega en vez de inventarse la base', () => {
  const servicioDeRecalculo = (c: any) => {
    const svc = Object.create(ReferralsService.prototype) as any;
    svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    svc.prisma = {
      commission: { findUnique: vi.fn(async () => c) },
      setting: { findUnique: vi.fn(async () => null) },
      referralCode: { findUnique: vi.fn(async () => null) },
    };
    svc.recalc = { getCommissionBase: vi.fn(async () => 500) };
    svc.computeExpectedCommissionRows = vi.fn(async (_t: string, base: number) => ({
      rows: [{ recipientCodeId: 'inf', amount: Math.round(base * 25) / 100, appliedPercent: 25 }],
    }));
    return svc;
  };

  const fila = (extra: any = {}) => ({
    id: 'c3',
    amount: 87.5,
    amountPaid: 0,
    baseAmountUsd: 350,
    status: 'PENDING',
    periodKey: 'UPG-2028-02-upg1',
    recipientCodeId: 'inf',
    referralUse: {
      tenant: {
        id: 'neg-1',
        brandName: 'Birria León',
        whiteLabelId: null,
        planPeriodicity: 'ANUAL',
        subscriptionPriceUsd: null,
      },
    },
    ...extra,
  });

  it('la comisión de un upgrade no se recalcula: lo dice y no toca nada', async () => {
    const svc = servicioDeRecalculo(fila());

    await expect(svc.recalcCommissionToExpected(SUPER, 'c3')).rejects.toThrow(
      /comisión de un upgrade/i,
    );
  });

  it('una de implementación sin base congelada tampoco', async () => {
    const svc = servicioDeRecalculo(
      fila({ periodKey: 'IMPL-2028-01-x9', baseAmountUsd: null, amount: 250 }),
    );

    await expect(svc.recalcCommissionToExpected(SUPER, 'c3')).rejects.toThrow(
      /cargo pactado aparte/i,
    );
  });
});

describe('los recálculos de fondo dejan fuera la comisión del upgrade', () => {
  it('recalcTenantSplit no la trae en su consulta', async () => {
    const svc = Object.create(ReferralsService.prototype) as any;
    svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    svc.audit = { log: vi.fn() };
    svc.recalc = { getCommissionBase: vi.fn(async () => 500) };
    svc.computeExpectedCommissionRows = vi.fn(async () => ({
      rows: [{ recipientCodeId: 'inf', amount: 125, appliedPercent: 25 }],
      mode: 'DISCOUNT_FROM_INFLUENCER',
    }));
    svc.prisma = {
      tenant: {
        findUnique: vi.fn(async () => ({
          subscriptionPriceUsd: null,
          planPeriodicity: 'ANUAL',
        })),
      },
      commission: { findMany: vi.fn(async () => []), update: vi.fn() },
    };

    await svc.recalcTenantSplit('neg-1', null, 'prueba');

    const where = svc.prisma.commission.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(NO_ES_DEL_UPGRADE.OR);
  });

  it('recalcForRecipientCode tampoco, y sin pisar su propio OR', async () => {
    const svc = Object.create(CommissionRecalcService.prototype) as any;
    svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    svc.audit = { log: vi.fn() };
    svc.prisma = {
      referralCode: { findUnique: vi.fn(async () => ({ id: 'inf', commissionPercent: 25 })) },
      commission: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), update: vi.fn() },
    };

    await svc.recalcForRecipientCode({ recipientCodeId: 'inf' });

    const where = svc.prisma.commission.findMany.mock.calls[0][0].where;
    // El filtro del upgrade va en AND: el OR de arriba ya lo usa el matcheo de
    // comisiones legacy con `recipientCodeId` nulo.
    expect(where.AND).toEqual([NO_ES_DEL_UPGRADE]);
    expect(where.OR).toHaveLength(2);
    expect(where.OR[1].recipientCodeId).toBeNull();
  });
});

describe('la trampa del NULL en el filtro', () => {
  /**
   * `NOT (periodKey LIKE 'UPG-%')` vale NULL —no TRUE— cuando la columna es
   * NULL, así que por sí solo deja fuera del recálculo TODAS las comisiones
   * legacy sin `periodKey`. Que son justo las que hay que recalcular.
   */
  const soloNot = (pk: string | null) => (pk == null ? false : !pk.startsWith('UPG-'));
  const conElOr = (pk: string | null) => pk == null || !pk.startsWith('UPG-');

  it('el filtro escrito a la ligera se come las comisiones legacy', () => {
    expect(soloNot(null)).toBe(false); // ← la trampa
    expect(conElOr(null)).toBe(true);
  });

  it('el filtro de verdad lleva la rama de los nulos', () => {
    expect(NO_ES_DEL_UPGRADE.OR[0]).toEqual({ periodKey: null });
  });

  it('las dos formas coinciden en todo lo demás', () => {
    for (const pk of ['2028-01', 'UPG-2028-02-x', 'IMPL-2028-01-y', 'ONCE']) {
      expect(soloNot(pk)).toBe(conElOr(pk));
    }
    expect(conElOr('UPG-2028-02-x')).toBe(false);
  });
});

describe('quién es de monto libre', () => {
  it('reconoce los dos prefijos, y solo esos', () => {
    expect(esDeMontoLibre('UPG-2028-02-abc')).toBe(true);
    expect(esDeMontoLibre('IMPL-2028-01-xyz')).toBe(true);
    expect(esDeMontoLibre('2028-02')).toBe(false);
    expect(esDeMontoLibre('ONCE')).toBe(false);
    expect(esDeMontoLibre(null)).toBe(false);
  });

  it('distingue el upgrade de la implementación', () => {
    expect(esDelUpgrade('UPG-2028-02-abc')).toBe(true);
    expect(esDelUpgrade('IMPL-2028-01-xyz')).toBe(false);
  });
});
