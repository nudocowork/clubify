import { describe, it, expect } from 'vitest';
import {
  cadenaDelCodigo,
  elegirUsoQueVendio,
  pctDePartidaDelInfluencer,
  repartoDeComision,
  type CadenaDeComision,
  type CodigoConSuperiores,
} from './reparto-de-comision';

/**
 * Quién cobra y cuánto por un cobro. Los casos son los de producción del
 * 2026-10-16 (MOTILART, Enchurrados TEX-MEX, Alquimia Café Bistro).
 */

const JUAN: CodigoConSuperiores = { id: 'juan', role: 'INFLUENCER', commissionPercent: 25 };
const SANTIAGO: CodigoConSuperiores = {
  id: 'santiago',
  role: 'AMBASSADOR',
  commissionPercent: 20,
  parentCode: JUAN,
};
const NICOLAS: CodigoConSuperiores = { id: 'nicolas', role: 'INFLUENCER', commissionPercent: 10 };
const GABRIEL_EMBAJADOR: CodigoConSuperiores = {
  id: 'gabriel',
  role: 'AMBASSADOR',
  commissionPercent: 5,
  parentCode: NICOLAS,
};

const uso = (
  id: string,
  role: string,
  createdAt: string,
  status: string | null = 'PAYING',
) => ({ id, status, createdAt: new Date(createdAt), referralCode: { role } });

/** Lo que hace cada camino: % de partida → (sin excepciones) → reparto. */
function repartir(
  code: CodigoConSuperiores,
  base: number,
  opts: { indirecto?: number; modo?: string } = {},
) {
  const cadena = cadenaDelCodigo(code);
  return repartoDeComision({
    base,
    cadena,
    influencerPct: pctDePartidaDelInfluencer(cadena, opts.indirecto ?? 5),
    embajadorPct: cadena.embajador?.commissionPercent ?? 0,
    vendorPctCrudo: cadena.vendor?.commissionPercent ?? 0,
    modo: opts.modo ?? 'DISCOUNT_FROM_INFLUENCER',
  });
}
const porPersona = (filas: Array<{ recipientCodeId: string; amount: number }>) =>
  Object.fromEntries(filas.map((f) => [f.recipientCodeId, f.amount]));

describe('elegirUsoQueVendio · quién vendió el negocio', () => {
  it('MOTILART: el parent-use del influencer es MÁS RECIENTE y aun así gana el embajador', () => {
    // El registro de Juan nace en el primer cobro, para colgar su indirecta.
    const usos = [
      uso('use-juan', 'INFLUENCER', '2026-07-22'),
      uso('use-santiago', 'AMBASSADOR', '2026-06-20'),
    ];
    expect(elegirUsoQueVendio(usos)?.id).toBe('use-santiago');
  });

  it('vendedor > embajador > influencer, sin importar la fecha', () => {
    const usos = [
      uso('inf', 'INFLUENCER', '2026-10-01'),
      uso('emb', 'AMBASSADOR', '2026-09-01'),
      uso('ven', 'VENDOR', '2026-08-01'),
    ];
    expect(elegirUsoQueVendio(usos)?.id).toBe('ven');
  });

  it('a igual rol gana el vivo sobre el dado de baja, y luego el más reciente', () => {
    expect(
      elegirUsoQueVendio([
        uso('viejo-vivo', 'AMBASSADOR', '2026-01-01', 'PAYING'),
        uso('nuevo-baja', 'AMBASSADOR', '2026-09-01', 'CHURNED'),
      ])?.id,
    ).toBe('viejo-vivo');
    expect(
      elegirUsoQueVendio([
        uso('viejo', 'AMBASSADOR', '2026-01-01'),
        uso('nuevo', 'AMBASSADOR', '2026-09-01'),
      ])?.id,
    ).toBe('nuevo');
  });

  it('el SOCIO no vende: sin afiliado de venta no hay elegido', () => {
    expect(elegirUsoQueVendio([uso('socio', 'SOCIO', '2026-09-01')])).toBeNull();
    expect(elegirUsoQueVendio([])).toBeNull();
  });

  it('un influencer solo, sin embajador detrás, sí es quien vendió', () => {
    expect(elegirUsoQueVendio([uso('inf', 'INFLUENCER', '2026-09-01')])?.id).toBe('inf');
  });
});

describe('cadenaDelCodigo · quién está arriba de quien vendió', () => {
  it('embajador → él + su influencer (que será indirecto)', () => {
    const c = cadenaDelCodigo(SANTIAGO);
    expect(c.sourceCodeId).toBe('santiago');
    expect(c.embajador?.id).toBe('santiago');
    expect(c.influencer?.id).toBe('juan');
    expect(c.vendor).toBeNull();
  });

  it('vendedor bajo un influencer → el influencer ocupa el hueco del embajador', () => {
    const c = cadenaDelCodigo({
      id: 'gabriel',
      role: 'VENDOR',
      commissionPercent: 5,
      parentEmbajadorCode: { ...NICOLAS },
    });
    expect(c.influencer).toBeNull();
    expect(c.embajador?.id).toBe('nicolas');
    expect(c.vendor?.id).toBe('gabriel');
  });

  it('vendedor bajo embajador con influencer → los tres', () => {
    const c = cadenaDelCodigo({
      id: 'v',
      role: 'VENDOR',
      commissionPercent: 5,
      parentEmbajadorCode: { ...SANTIAGO, parentCode: JUAN },
    });
    expect([c.vendor?.id, c.embajador?.id, c.influencer?.id]).toEqual(['v', 'santiago', 'juan']);
  });

  it('vendedor sin superior → cobra como si fuera influencer directo (como siempre)', () => {
    const c = cadenaDelCodigo({ id: 'v', role: 'VENDOR', commissionPercent: 7 });
    expect(c.influencer).toEqual({ id: 'v', commissionPercent: 7 });
    expect(c.vendor).toBeNull();
  });
});

describe('repartoDeComision · los casos de producción', () => {
  it('MOTILART ($50): Santiago su % y Juan el 5 % — nunca el 25 % de Juan', () => {
    const r = porPersona(repartir(SANTIAGO, 50));
    expect(r).toEqual({ juan: 2.5, santiago: 10 });
    expect(r.juan).not.toBe(12.5);
  });

  it('Enchurrados TEX-MEX ($150 trimestral): Gabriel 5 % + Nicolás 5 % = $7,50 y $7,50', () => {
    expect(porPersona(repartir(GABRIEL_EMBAJADOR, 150))).toEqual({ nicolas: 7.5, gabriel: 7.5 });
  });

  it('Alquimia Café Bistro ($500 anual), mismo Gabriel: $25 y $25', () => {
    expect(porPersona(repartir(GABRIEL_EMBAJADOR, 500))).toEqual({ nicolas: 25, gabriel: 25 });
  });

  it('vendedor bajo influencer, modo DISCOUNT: el vendedor sale de la tajada del influencer', () => {
    const vendedor: CodigoConSuperiores = {
      id: 'gabriel',
      role: 'VENDOR',
      commissionPercent: 5,
      parentEmbajadorCode: { ...NICOLAS },
    };
    expect(porPersona(repartir(vendedor, 500))).toEqual({ nicolas: 25, gabriel: 25 });
    // ADICIONAL: el vendedor es un costo extra, el influencer conserva su 10 %.
    expect(porPersona(repartir(vendedor, 500, { modo: 'ADDITIONAL_COMPANY_COMMISSION' }))).toEqual({
      nicolas: 50,
      gabriel: 25,
    });
  });

  it('el vendedor nunca se lleva más que la tajada del embajador (DISCOUNT)', () => {
    const vendedor: CodigoConSuperiores = {
      id: 'v',
      role: 'VENDOR',
      commissionPercent: 30,
      parentEmbajadorCode: { ...SANTIAGO, parentCode: JUAN },
    };
    expect(porPersona(repartir(vendedor, 100))).toEqual({ juan: 5, v: 20 });
  });

  it('influencer que vende directo: su % completo, sin indirecta', () => {
    expect(porPersona(repartir(JUAN, 50))).toEqual({ juan: 12.5 });
  });

  it('una fila al 0 % no se crea', () => {
    const cadena: CadenaDeComision = cadenaDelCodigo(SANTIAGO);
    const filas = repartoDeComision({
      base: 50,
      cadena,
      influencerPct: 0,
      embajadorPct: 20,
      vendorPctCrudo: 0,
      modo: 'DISCOUNT_FROM_INFLUENCER',
    });
    expect(filas.map((f) => f.recipientCodeId)).toEqual(['santiago']);
  });

  it('INVARIANTE: si la venta no la hizo el influencer, nunca cobra su % propio', () => {
    const fuentes: CodigoConSuperiores[] = [
      SANTIAGO,
      { id: 'v1', role: 'VENDOR', commissionPercent: 5, parentEmbajadorCode: { ...SANTIAGO, parentCode: JUAN } },
    ];
    for (const fuente of fuentes) {
      for (const base of [50, 68, 150, 278, 500]) {
        for (const modo of ['DISCOUNT_FROM_INFLUENCER', 'ADDITIONAL_COMPANY_COMMISSION']) {
          const filaJuan = repartir(fuente, base, { modo }).find((f) => f.recipientCodeId === 'juan');
          expect(filaJuan?.appliedPercent).toBe(5);
        }
      }
    }
  });
});
