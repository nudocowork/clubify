/**
 * El reparto de la comisión del upgrade da EXACTAMENTE lo mismo que el motor.
 *
 * NO necesita base de datos ni red.
 *
 * Por qué existe este archivo: el upgrade no puede usar
 * `generateCommissionsForPayment` porque ese camino calcula la base con el
 * precio pactado o el canónico y **ignora el monto pagado** — que es justo lo
 * que manda en un upgrade. Así que el reparto se repite en una función pura
 * (`filasDeComisionDelUpgrade`), y estas pruebas son el freno contra que esa
 * copia se desincronice: pasan los MISMOS datos por la función nueva y por
 * `computeExpectedCommissionRows` (el reparto de siempre, intocado) y exigen
 * que devuelvan lo mismo, fila por fila.
 *
 * Si alguien cambia el reparto del motor y no cambia la función pura, el bloque
 * «no regresión» se pone en rojo. Esa es toda la gracia.
 */
import { describe, it, expect, vi } from 'vitest';
import { ReferralsService } from '../referrals/referrals.service';
import {
  filasDeComisionDelUpgrade,
  periodKeyDelUpgrade,
} from './comision-del-upgrade';

type Cadena = {
  influencer: { id: string; commissionPercent: number } | null;
  embajador: { id: string; commissionPercent: number; maxCommissionPercent: number } | null;
  vendor: { id: string; commissionPercent: number } | null;
  sourceCodeId: string | null;
};

const INFLUENCER_DIRECTO: Cadena = {
  influencer: { id: 'inf', commissionPercent: 25 },
  embajador: null,
  vendor: null,
  sourceCodeId: 'inf',
};

const EMBAJADOR_CON_INFLUENCER: Cadena = {
  influencer: { id: 'inf', commissionPercent: 25 },
  embajador: { id: 'emb', commissionPercent: 20, maxCommissionPercent: 25 },
  vendor: null,
  sourceCodeId: 'emb',
};

const CON_VENDEDOR: Cadena = {
  influencer: { id: 'inf', commissionPercent: 25 },
  embajador: { id: 'emb', commissionPercent: 20, maxCommissionPercent: 25 },
  vendor: { id: 'ven', commissionPercent: 8 },
  sourceCodeId: 'ven',
};

/** El vendedor pide MÁS de lo que tiene el embajador: hay que acotarlo. */
const VENDEDOR_PASADO: Cadena = {
  influencer: null,
  embajador: { id: 'emb', commissionPercent: 10, maxCommissionPercent: 25 },
  vendor: { id: 'ven', commissionPercent: 30 },
  sourceCodeId: 'ven',
};

/** El motor de siempre, con la base de datos simulada. */
function motor(opts: {
  cadena: Cadena;
  modo?: 'DISCOUNT_FROM_INFLUENCER' | 'ADDITIONAL_COMPANY_COMMISSION';
  excepciones?: Record<string, number>;
  indirectPct?: string;
}) {
  const svc = Object.create(ReferralsService.prototype) as any;
  svc.prisma = {
    tenant: {
      findUnique: vi.fn(async () => ({
        commissionDistributionMode: opts.modo ?? 'DISCOUNT_FROM_INFLUENCER',
        whiteLabelId: null,
      })),
    },
    setting: {
      findUnique: vi.fn(async () => ({ value: opts.indirectPct ?? '5' })),
    },
  };
  svc.getAttributionChain = vi.fn(async () => opts.cadena);
  svc.slugForWhiteLabelId = vi.fn(async () => null);
  svc.getBrandCommissionMode = vi.fn(async () => 'PERCENT_RECURRING');
  svc.commissionExceptions = {
    resolvePercent: vi.fn(
      async (_t: string, codeId: string, fallback: number) =>
        opts.excepciones?.[codeId] ?? fallback,
    ),
  };
  return svc;
}

/**
 * Los porcentajes YA resueltos, con las mismas reglas que el motor: excepción
 * por negocio si la hay, y el influencer al % INDIRECTO cuando la venta no la
 * hizo él. Esta resolución NO está duplicada en producción (el servicio llama a
 * `CommissionExceptionsService.resolvePercent` y al mismo Setting); aquí se
 * reproduce para poder alimentar a los dos lados con lo mismo.
 */
function pctsResueltos(opts: {
  cadena: Cadena;
  excepciones?: Record<string, number>;
  indirectPct?: number;
}) {
  const { cadena } = opts;
  const exc = (id: string, fallback: number) => opts.excepciones?.[id] ?? fallback;
  const esIndirecto = !!cadena.influencer && cadena.influencer.id !== cadena.sourceCodeId;
  return {
    influencerPct: cadena.influencer
      ? exc(
          cadena.influencer.id,
          esIndirecto ? (opts.indirectPct ?? 5) : cadena.influencer.commissionPercent,
        )
      : 0,
    embajadorPct: cadena.embajador
      ? exc(cadena.embajador.id, cadena.embajador.commissionPercent)
      : 0,
    vendorPctCrudo: cadena.vendor
      ? exc(cadena.vendor.id, cadena.vendor.commissionPercent)
      : 0,
  };
}

describe('comisión del upgrade · NO REGRESIÓN contra el motor de siempre', () => {
  const casos: Array<{
    nombre: string;
    cadena: Cadena;
    base: number;
    modo?: 'DISCOUNT_FROM_INFLUENCER' | 'ADDITIONAL_COMPANY_COMMISSION';
    excepciones?: Record<string, number>;
  }> = [
    { nombre: 'influencer directo', cadena: INFLUENCER_DIRECTO, base: 350 },
    { nombre: 'influencer directo con excepción al 20 %', cadena: INFLUENCER_DIRECTO, base: 350, excepciones: { inf: 20 } },
    { nombre: 'embajador + influencer indirecto (5 %)', cadena: EMBAJADOR_CON_INFLUENCER, base: 500 },
    { nombre: 'embajador + vendedor (el vendedor sale del embajador)', cadena: CON_VENDEDOR, base: 420 },
    { nombre: 'embajador + vendedor en modo ADICIONAL', cadena: CON_VENDEDOR, base: 420, modo: 'ADDITIONAL_COMPANY_COMMISSION' },
    { nombre: 'vendedor pidiendo más que su embajador (se acota)', cadena: VENDEDOR_PASADO, base: 500 },
    { nombre: 'importe con decimales feos', cadena: CON_VENDEDOR, base: 333.33 },
    { nombre: 'excepciones en los tres niveles', cadena: CON_VENDEDOR, base: 500, excepciones: { inf: 3, emb: 15, ven: 7 } },
  ];

  for (const caso of casos) {
    it(`da lo mismo que computeExpectedCommissionRows: ${caso.nombre}`, async () => {
      const svc = motor({
        cadena: caso.cadena,
        modo: caso.modo,
        excepciones: caso.excepciones,
      });
      const { rows } = await svc.computeExpectedCommissionRows('negocio', caso.base);

      const filas = filasDeComisionDelUpgrade({
        base: caso.base,
        cadena: caso.cadena,
        modo: caso.modo ?? 'DISCOUNT_FROM_INFLUENCER',
        ...pctsResueltos({ cadena: caso.cadena, excepciones: caso.excepciones }),
      });

      expect(filas).toEqual(rows);
      // Y que el caso no sea vacío por accidente: una comparación de dos
      // listas vacías no prueba nada.
      expect(filas.length).toBeGreaterThan(0);
    });
  }
});

describe('comisión del upgrade · la base es el monto pagado', () => {
  it('350 pagados al 25 % son $87,50 — no los $125 del anual de lista', () => {
    const filas = filasDeComisionDelUpgrade({
      base: 350,
      cadena: INFLUENCER_DIRECTO,
      influencerPct: 25,
      embajadorPct: 0,
      vendorPctCrudo: 0,
      modo: 'DISCOUNT_FROM_INFLUENCER',
    });
    expect(filas).toEqual([
      { recipientCodeId: 'inf', vendorCodeId: null, amount: 87.5, appliedPercent: 25 },
    ]);
  });

  it('base 0 o negativa no genera ninguna fila', () => {
    for (const base of [0, -100]) {
      expect(
        filasDeComisionDelUpgrade({
          base,
          cadena: INFLUENCER_DIRECTO,
          influencerPct: 25,
          embajadorPct: 0,
          vendorPctCrudo: 0,
          modo: 'DISCOUNT_FROM_INFLUENCER',
        }),
      ).toEqual([]);
    }
  });

  it('un beneficiario al 0 % no recibe una fila de $0', () => {
    expect(
      filasDeComisionDelUpgrade({
        base: 350,
        cadena: INFLUENCER_DIRECTO,
        influencerPct: 0,
        embajadorPct: 0,
        vendorPctCrudo: 0,
        modo: 'DISCOUNT_FROM_INFLUENCER',
      }),
    ).toEqual([]);
  });
});

describe('comisión del upgrade · el periodKey no puede chocar con los existentes', () => {
  it('lleva el mes dentro y el id del upgrade, así que es único', () => {
    const k = periodKeyDelUpgrade(new Date('2026-09-15T12:00:00.000Z'), 'upg-abc');
    expect(k).toBe('UPG-2026-09-upg-abc');
  });

  it('dos upgrades del mismo mes no comparten clave', () => {
    const d = new Date('2026-09-15T12:00:00.000Z');
    expect(periodKeyDelUpgrade(d, 'a')).not.toBe(periodKeyDelUpgrade(d, 'b'));
  });

  it('NUNCA es el `YYYY-MM` que usa el motor: el UNIQUE de la base no lo puede frenar', () => {
    // El motor guarda `2026-09`. Si el upgrade usara esa misma clave, la
    // UNIQUE (referralUseId, recipientCodeId, periodKey) rechazaría la fila
    // cuando el negocio ya tuviera comisión de ese mes — y el skip es
    // silencioso: nadie se enteraría de que el afiliado no cobró.
    const k = periodKeyDelUpgrade(new Date('2026-09-15T12:00:00.000Z'), 'upg-abc');
    expect(k).not.toBe('2026-09');
    expect(k.startsWith('UPG-')).toBe(true);
  });
});

describe('el motor de siempre sigue calculando igual (no lo tocó el upgrade)', () => {
  it('generateCommissionsForPayment sigue usando la base canónica, no el monto pagado', async () => {
    const svc = Object.create(ReferralsService.prototype) as any;
    svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const creadas: any[] = [];
    const tx = {
      commission: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async (args: any) => {
          creadas.push(args.data);
          return {};
        }),
      },
    };
    svc.prisma = {
      tenant: {
        findUnique: vi.fn(async () => ({
          subscriptionPriceUsd: null,
          planPeriodicity: 'ANUAL',
          lastChargeAt: new Date('2026-09-15T12:00:00.000Z'),
        })),
      },
      referralUse: { findFirst: vi.fn(async () => ({ id: 'use-1' })) },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };
    // El canónico del anual: 500. El motor lo pide y lo usa aunque el pago
    // haya sido de otra cifra — es su regla y no la cambia el upgrade.
    svc.recalc = { getCommissionBase: vi.fn(async () => 500) };
    svc.computeExpectedCommissionRows = vi.fn(async () => ({
      chain: { sourceCodeId: 'inf' },
      rows: [
        { recipientCodeId: 'inf', vendorCodeId: null, amount: 125, appliedPercent: 25 },
      ],
      mode: 'DISCOUNT_FROM_INFLUENCER',
    }));

    await svc.generateCommissionsForPayment({
      tenantId: 't1',
      paymentAmountUsd: 350, // el monto crudo: el motor lo ignora, como siempre
    });

    const [fila] = creadas;
    expect(fila.amount).toBe(125);
    expect(fila.baseAmountUsd).toBe(500);
    expect(fila.periodKey).toBe('2026-09');
  });
});
