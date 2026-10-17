import { describe, expect, it } from 'vitest';
import {
  basePactadaDelCobro,
  comisionesDeParticipaciones,
  coincideConLaVenta,
  elegirReglaDeColaborador,
  ajusteDeLaRegla,
  type ReglaDeColaborador,
  type ReglaDeParticipacion,
  type VentaParaParticipar,
} from './reglas-de-comision';
import { repartoDeComision } from './reparto-de-comision';
import {
  anularParticipacionesDevueltas,
  escribirParticipaciones,
  evaluarIngresos,
  MARCA_ANULADA_POR_DEVOLUCION,
  PRECIOS_CANONICOS_POR_DEFECTO,
  preciosCanonicos,
  type IngresoParaEvaluar,
} from './participaciones-motor';
import { NO_ES_DEL_UPGRADE, NO_ES_DE_EQUIPO, esDeMontoLibre, tieneReglaPropia } from './comisiones-de-monto-libre';

/**
 * Participaciones globales (2026-10-17): Javier 10 % y Sara Plata 2 % sobre el
 * precio pactado del plan de cada venta de Clubify, ADICIONALES a la comisión
 * del vendedor. Y reglas por colaborador (fija, nueva vs renovación).
 */

const CLUBIFY = 'wl-clubify';
const JAVIER = 'code-javier';
const SARA = 'code-sara';

const reglaJavier: ReglaDeParticipacion = {
  id: 'p-javier',
  nombre: 'Javier — socio comercial',
  beneficiarioCodeId: JAVIER,
  tipo: 'PORCENTAJE',
  valor: 10,
  aplicaA: 'AMBAS',
  activo: true,
  createdAt: new Date('2026-10-17T12:00:00Z'),
};
const reglaSara: ReglaDeParticipacion = {
  ...reglaJavier,
  id: 'p-sara',
  nombre: 'Sara Plata — PM',
  beneficiarioCodeId: SARA,
  valor: 2,
};
const REGLAS = [reglaJavier, reglaSara];

const venta = (o: Partial<VentaParaParticipar> = {}): VentaParaParticipar => ({
  ingresoId: 'ing-1',
  estado: 'PAGADO',
  tipo: 'NUEVA',
  esDeClubify: true,
  tenantId: 't-1',
  fecha: new Date('2026-09-20T15:00:00Z'),
  periodicidad: 'TRIMESTRAL',
  planId: null,
  baseUsd: 150,
  ...o,
});

describe('participaciones · la cuenta', () => {
  it('10 % y 2 % sobre el PRECIO DEL PLAN, no sobre lo cobrado', () => {
    const { filas, exclusion } = comisionesDeParticipaciones(venta({ baseUsd: 150 }), REGLAS);
    expect(exclusion).toBeNull();
    expect(filas.map((f) => [f.recipientCodeId, f.amount, f.appliedPercent, f.baseAmountUsd])).toEqual([
      [JAVIER, 15, 10, 150],
      [SARA, 3, 2, 150],
    ]);
  });

  it('venta de $100 con closer al 5 %: Javier 10 + Sara 2 + closer 5 = 17, y lo vendido sigue siendo 100', () => {
    const base = 100;
    const closer = repartoDeComision({
      base,
      cadena: { influencer: null, embajador: null, vendor: { id: 'closer' } },
      influencerPct: 0,
      embajadorPct: 0,
      vendorPctCrudo: 5,
      modo: 'DISCOUNT_FROM_INFLUENCER',
    });
    const { filas } = comisionesDeParticipaciones(venta({ baseUsd: base }), REGLAS);
    const todas = [...closer, ...filas];
    expect(todas.map((f) => f.amount)).toEqual([5, 10, 2]);
    expect(todas.reduce((s, f) => s + f.amount, 0)).toBe(17);
    // Las participaciones salen del MISMO cobro: no crean otra venta. La base
    // de todas es la misma y única venta de $100.
    expect(new Set(filas.map((f) => f.ingresoId))).toEqual(new Set(['ing-1']));
    expect(filas.every((f) => f.baseAmountUsd === base)).toBe(true);
  });

  it('renovación: con «AMBAS» participa; con «NUEVAS» no; con «RENOVACIONES» sí', () => {
    const v = venta({ tipo: 'RENOVACION' });
    expect(comisionesDeParticipaciones(v, REGLAS).filas).toHaveLength(2);
    expect(comisionesDeParticipaciones(v, [{ ...reglaJavier, aplicaA: 'NUEVAS' }]).filas).toHaveLength(0);
    expect(comisionesDeParticipaciones(v, [{ ...reglaJavier, aplicaA: 'RENOVACIONES' }]).filas).toHaveLength(1);
    expect(comisionesDeParticipaciones(venta({ tipo: 'NUEVA' }), [{ ...reglaJavier, aplicaA: 'RENOVACIONES' }]).filas).toHaveLength(0);
  });

  it('venta reembolsada o cancelada: no genera nada, y dice por qué', () => {
    for (const estado of ['REEMBOLSADO', 'CANCELADO']) {
      const r = comisionesDeParticipaciones(venta({ estado }), REGLAS);
      expect(r.filas).toEqual([]);
      expect(r.exclusion).toBe('REEMBOLSADA');
    }
    expect(comisionesDeParticipaciones(venta({ estado: 'EN_REVISION' }), REGLAS).exclusion).toBe('NO_PAGADA');
  });

  it('marca blanca: fuera (el cobro es de la marca, no de Clubify)', () => {
    const r = comisionesDeParticipaciones(venta({ esDeClubify: false }), REGLAS);
    expect(r.filas).toEqual([]);
    expect(r.exclusion).toBe('MARCA_BLANCA');
  });

  it('sin precio de plan o sin ser venta de plan: fuera, con su motivo', () => {
    expect(comisionesDeParticipaciones(venta({ baseUsd: null }), REGLAS).exclusion).toBe('SIN_PRECIO_DE_PLAN');
    expect(comisionesDeParticipaciones(venta({ tipo: null }), REGLAS).exclusion).toBe('NO_ES_VENTA_DE_PLAN');
    expect(comisionesDeParticipaciones(venta({ tenantId: null }), REGLAS).exclusion).toBe('SIN_NEGOCIO');
  });

  it('vigencia: desde inclusiva, hasta exclusiva; null = desde siempre', () => {
    const r = { ...reglaJavier, vigenteDesde: new Date('2026-09-01T05:00:00Z'), vigenteHasta: new Date('2026-10-01T05:00:00Z') };
    expect(comisionesDeParticipaciones(venta({ fecha: new Date('2026-08-31T12:00:00Z') }), [r]).filas).toHaveLength(0);
    expect(comisionesDeParticipaciones(venta({ fecha: new Date('2026-09-01T05:00:00Z') }), [r]).filas).toHaveLength(1);
    expect(comisionesDeParticipaciones(venta({ fecha: new Date('2026-10-01T05:00:00Z') }), [r]).filas).toHaveLength(0);
    // «Desde siempre»: una venta de mayo también participa (lo aplica el backfill).
    expect(comisionesDeParticipaciones(venta({ fecha: new Date('2026-05-03T12:00:00Z') }), REGLAS).filas).toHaveLength(2);
  });

  it('en vivo, una regla no cubre cobros llegados antes de crearla (eso es del backfill)', () => {
    const viejo = venta({ fecha: new Date('2026-10-10T12:00:00Z') });
    const enVivo = { soloVigentesEnVivo: { ingresoCreadoEl: new Date('2026-10-10T12:01:00Z') } };
    expect(comisionesDeParticipaciones(viejo, REGLAS, enVivo).filas).toHaveLength(0);
    const nuevo = venta({ fecha: new Date('2026-10-18T12:00:00Z') });
    expect(comisionesDeParticipaciones(nuevo, REGLAS, { soloVigentesEnVivo: { ingresoCreadoEl: nuevo.fecha } }).filas).toHaveLength(2);
  });

  it('regla inactiva o filtros de periodicidad / negocio', () => {
    expect(comisionesDeParticipaciones(venta(), [{ ...reglaJavier, activo: false }]).filas).toHaveLength(0);
    expect(comisionesDeParticipaciones(venta(), [{ ...reglaJavier, periodicidades: ['ANUAL'] }]).filas).toHaveLength(0);
    expect(comisionesDeParticipaciones(venta(), [{ ...reglaJavier, periodicidades: ['trimestral'] }]).filas).toHaveLength(1);
    expect(comisionesDeParticipaciones(venta(), [{ ...reglaJavier, negociosExcluidos: ['t-1'] }]).filas).toHaveLength(0);
    expect(comisionesDeParticipaciones(venta(), [{ ...reglaJavier, negociosIncluidos: ['t-2'] }]).filas).toHaveLength(0);
  });

  it('participación FIJA: el monto tal cual, sin %', () => {
    const { filas } = comisionesDeParticipaciones(venta(), [{ ...reglaJavier, tipo: 'FIJO', valor: 7 }]);
    expect(filas).toEqual([expect.objectContaining({ amount: 7, appliedPercent: null, baseAmountUsd: 150 })]);
  });
});

describe('participaciones · la base pactada', () => {
  const canonico = (p: string | null) => PRECIOS_CANONICOS_POR_DEFECTO[(p ?? '').toUpperCase()] ?? 0;

  it('manda la base con la que NACIÓ la comisión del vendedor de ese cobro', () => {
    expect(basePactadaDelCobro({ baseDeLaComisionDelCobro: 135, tipo: 'RENOVACION', grossUsd: 129.9, periodicidadDelCobro: 'TRIMESTRAL', canonico })).toBe(135);
  });

  it('sin comisión: el override del negocio si el cobro es de su periodicidad de hoy', () => {
    const negocio = { subscriptionPriceUsd: 50, planPeriodicity: 'MENSUAL' };
    expect(basePactadaDelCobro({ tipo: 'RENOVACION', grossUsd: 48.7, periodicidadDelCobro: 'MENSUAL', negocio, canonico })).toBe(50);
  });

  it('tras un upgrade, los cobros viejos usan el canónico de SU periodicidad, no el precio de hoy', () => {
    const negocio = { subscriptionPriceUsd: 500, planPeriodicity: 'ANUAL' };
    expect(basePactadaDelCobro({ tipo: 'RENOVACION', grossUsd: 149, periodicidadDelCobro: 'TRIMESTRAL', negocio, canonico })).toBe(150);
  });

  it('el UPGRADE va sobre lo que se pagó por el cambio; el grupo sobre su precio', () => {
    expect(basePactadaDelCobro({ tipo: 'UPGRADE', grossUsd: 350, periodicidadDelCobro: 'ANUAL', canonico })).toBe(350);
    expect(basePactadaDelCobro({ tipo: 'RENOVACION', grossUsd: 0, grupo: { priceUsd: 150, planPeriodicity: 'MENSUAL' }, canonico })).toBe(150);
  });

  it('sin periodicidad en ningún sitio no inventa un MENSUAL', () => {
    expect(basePactadaDelCobro({ tipo: 'NUEVA', grossUsd: 80, canonico })).toBeNull();
  });

  it('los precios canónicos del motor son los mismos que los de /admin/branding', async () => {
    const sinAjustes = await preciosCanonicos({ setting: { findMany: async () => [] } });
    expect(['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'].map(sinAjustes)).toEqual([68, 150, 278, 500]);
    const conAjuste = await preciosCanonicos({
      setting: { findMany: async () => [{ key: 'landing.plans.mensual.price', value: '70' }] },
    });
    expect(conAjuste('MENSUAL')).toBe(70);
  });
});

// ── Base falsa para el motor: lo justo para escribir, deduplicar y anular ──
function baseFalsa(opts: {
  ingresos: IngresoParaEvaluar[];
  negocios?: Array<{ id: string; whiteLabelId: string | null; subscriptionPriceUsd: number | null; planPeriodicity: string | null }>;
  comisionesDeVenta?: any[];
}) {
  const comisiones: any[] = [];
  const db = {
    setting: { findMany: async () => [] },
    whiteLabel: { findFirst: async () => ({ id: CLUBIFY }) },
    tenant: {
      findMany: async ({ where }: any) => (opts.negocios ?? []).filter((n) => where.id.in.includes(n.id)),
    },
    businessGroup: { findMany: async () => [] },
    incomeRecord: {
      findMany: async ({ where }: any) =>
        opts.ingresos
          .filter((i) => !where?.id?.in || where.id.in.includes(i.id))
          .filter((i) => !where?.status?.in || where.status.in.includes(i.status))
          .map((i) => ({ id: i.id, status: i.status })),
    },
    commission: {
      findMany: async ({ where }: any) => {
        if (where.participacionId === null) return opts.comisionesDeVenta ?? [];
        return comisiones.filter(
          (c) => c.participacionId && where.status.in.includes(c.status) && c.paymentStatus === 'PENDING' && c.amountPaid <= 0,
        );
      },
      // `skipDuplicates` = ON CONFLICT DO NOTHING sobre la UNIQUE (participacionId, ingresoId).
      createMany: async ({ data, skipDuplicates }: any) => {
        let count = 0;
        for (const d of data) {
          const choca = comisiones.some((c) => c.participacionId === d.participacionId && c.ingresoId === d.ingresoId);
          if (choca && skipDuplicates) continue;
          if (choca) throw Object.assign(new Error('P2002'), { code: 'P2002' });
          comisiones.push({ id: `c-${comisiones.length + 1}`, ...d });
          count++;
        }
        return { count };
      },
      updateMany: async ({ where, data }: any) => {
        const c = comisiones.find((x) => x.id === where.id && where.status.in.includes(x.status));
        if (!c) return { count: 0 };
        Object.assign(c, data);
        return { count: 1 };
      },
    },
  };
  return { db, comisiones };
}

const ingreso = (o: Partial<IngresoParaEvaluar> = {}): IngresoParaEvaluar => ({
  id: 'ing-1',
  externalTxId: 'HP123',
  gateway: 'HOTMART',
  tenantId: 't-1',
  businessGroupId: null,
  whiteLabelId: CLUBIFY,
  payerWhiteLabelId: null,
  brandName: 'Wok Explosivo',
  planId: null,
  planPeriodicity: 'MENSUAL',
  category: 'NUEVA',
  isFirstPayment: true,
  status: 'PAGADO',
  grossUsd: 66.4,
  periodKey: '2026-09',
  saleDate: new Date('2026-09-28T15:00:00Z'),
  createdAt: new Date('2026-09-28T15:00:05Z'),
  ...o,
});

describe('participaciones · el motor contra la base', () => {
  const negocios = [{ id: 't-1', whiteLabelId: CLUBIFY, subscriptionPriceUsd: null, planPeriodicity: 'MENSUAL' }];

  it('escribe PENDING, con la retención de la casa, el periodKey del cobro y la transacción', async () => {
    const { db, comisiones } = baseFalsa({ ingresos: [ingreso()], negocios });
    const ev = await evaluarIngresos(db, [ingreso()], REGLAS, { enVivo: false });
    const r = await escribirParticipaciones(db, ev, REGLAS, { prefijoDeNota: 'Participación histórica (backfill 2026-10-17).' });
    expect(r).toEqual({ intentadas: 2, creadas: 2 });
    expect(comisiones.map((c) => [c.recipientCodeId, c.amount])).toEqual([
      [JAVIER, 6.8],
      [SARA, 1.36],
    ]);
    const c = comisiones[0];
    expect(c.status).toBe('PENDING');
    expect(c.referralUseId).toBeNull();
    expect(c.periodKey).toBe('PART-2026-09');
    expect(c.availableAt.toISOString()).toBe('2026-10-13T15:00:00.000Z');
    expect(c.externalTxId).toBe('HP123');
    expect(c.hotmartTransactionId).toBeUndefined();
    expect(c.notes).toMatch(/^Participación histórica \(backfill 2026-10-17\)\./);
  });

  it('dedup: webhook repetido, repaso del cron y backfill corrido dos veces no duplican', async () => {
    const { db, comisiones } = baseFalsa({ ingresos: [ingreso()], negocios });
    const correr = async () => escribirParticipaciones(db, await evaluarIngresos(db, [ingreso()], REGLAS, { enVivo: false }), REGLAS);
    expect((await correr()).creadas).toBe(2); // webhook
    expect((await correr()).creadas).toBe(0); // el mismo aviso otra vez
    expect((await correr()).creadas).toBe(0); // el cron
    expect((await correr()).creadas).toBe(0); // backfill, segunda vez
    expect(comisiones).toHaveLength(2);
  });

  it('marca blanca: ni el ingreso ni el negocio de otra marca generan nada', async () => {
    const otra = [{ id: 't-1', whiteLabelId: 'wl-sellea', subscriptionPriceUsd: null, planPeriodicity: 'MENSUAL' }];
    const { db } = baseFalsa({ ingresos: [ingreso()], negocios: otra });
    const [e] = await evaluarIngresos(db, [ingreso()], REGLAS, { enVivo: false });
    expect(e.exclusion).toBe('MARCA_BLANCA');
    const [e2] = await evaluarIngresos(db, [ingreso({ payerWhiteLabelId: 'wl-x', tenantId: null, category: 'MARCA_BLANCA' })], REGLAS, { enVivo: false });
    expect(e2.filas).toEqual([]);
  });

  it('usa la base de la comisión del vendedor de ESE cobro ($50 legacy), no el canónico', async () => {
    const { db } = baseFalsa({
      ingresos: [ingreso()],
      negocios,
      comisionesDeVenta: [
        { externalTxId: 'HP123', hotmartTransactionId: 'HP123', baseAmountUsd: 50, businessDate: null, businessGroupId: null, periodKey: '2026-09', referralUse: { tenantId: 't-1' } },
      ],
    });
    const [e] = await evaluarIngresos(db, [ingreso()], REGLAS, { enVivo: false });
    expect(e.venta.baseUsd).toBe(50);
    expect(e.filas.map((f) => f.amount)).toEqual([5, 1]);
  });

  it('reembolso: anula (REJECTED con nota) las participaciones vivas de ese cobro, no las pagadas', async () => {
    const ing = ingreso();
    const { db, comisiones } = baseFalsa({ ingresos: [ing], negocios });
    await escribirParticipaciones(db, await evaluarIngresos(db, [ing], REGLAS, { enVivo: false }), REGLAS);
    comisiones[1].paymentStatus = 'PAID'; // la de Sara ya se pagó
    comisiones[1].status = 'PAID';
    ing.status = 'REEMBOLSADO';
    const sim = await anularParticipacionesDevueltas(db, { simular: true });
    expect(sim).toHaveLength(1);
    expect(comisiones[0].status).toBe('PENDING'); // simular no escribe
    const anuladas = await anularParticipacionesDevueltas(db, { ahora: new Date('2026-10-17T12:00:00Z') });
    expect(anuladas.map((a) => a.id)).toEqual([comisiones[0].id]);
    expect(comisiones[0].status).toBe('REJECTED');
    expect(comisiones[0].notes).toContain(MARCA_ANULADA_POR_DEVOLUCION);
    expect(comisiones[1].status).toBe('PAID');
    // Una vez anulada, el repaso no la vuelve a crear (la fila sigue existiendo).
    ing.status = 'PAGADO';
    const otra = await escribirParticipaciones(db, await evaluarIngresos(db, [ing], REGLAS, { enVivo: false }), REGLAS);
    expect(otra.creadas).toBe(0);
  });

  it('cambiar el % de la regla NO toca las comisiones ya creadas', async () => {
    const { db, comisiones } = baseFalsa({ ingresos: [ingreso()], negocios });
    await escribirParticipaciones(db, await evaluarIngresos(db, [ingreso()], REGLAS, { enVivo: false }), REGLAS);
    const antes = comisiones.map((c) => ({ amount: c.amount, appliedPercent: c.appliedPercent, base: c.baseAmountUsd }));
    const subida = [{ ...reglaJavier, valor: 15 }, reglaSara];
    await escribirParticipaciones(db, await evaluarIngresos(db, [ingreso()], subida, { enVivo: false }), subida);
    expect(comisiones.map((c) => ({ amount: c.amount, appliedPercent: c.appliedPercent, base: c.baseAmountUsd }))).toEqual(antes);
  });
});

describe('participaciones · nadie las recalcula', () => {
  it('PART- es monto libre y los filtros de recálculo y arqueo las dejan fuera', () => {
    expect(esDeMontoLibre('PART-2026-09')).toBe(true);
    expect(NO_ES_DEL_UPGRADE).toMatchObject({ participacionId: null, reglaColaboradorId: null });
    expect(NO_ES_DE_EQUIPO).toMatchObject({ participacionId: null });
    expect(tieneReglaPropia({ participacionId: 'p' })).toBe(true);
    expect(tieneReglaPropia({ reglaColaboradorId: 'r' })).toBe(true);
    expect(tieneReglaPropia({})).toBe(false);
  });
});

describe('reglas por colaborador', () => {
  const base: ReglaDeColaborador = {
    id: 'r-todas',
    codeId: 'closer',
    prioridad: 0,
    tipo: 'PORCENTAJE',
    valor: 8,
    aplicaA: 'AMBAS',
    activo: true,
    createdAt: new Date('2026-10-01'),
  };
  const renovacionFija: ReglaDeColaborador = { ...base, id: 'r-renov', tipo: 'FIJO', valor: 4, aplicaA: 'RENOVACIONES' };
  const v = (tipo: 'NUEVA' | 'RENOVACION') => ({ fecha: new Date('2026-10-20T12:00:00Z'), tipo, periodicidad: 'MENSUAL' });

  it('nueva vs renovación: la más específica gana a igual prioridad', () => {
    expect(elegirReglaDeColaborador([base, renovacionFija], 'closer', v('NUEVA'))?.id).toBe('r-todas');
    expect(elegirReglaDeColaborador([base, renovacionFija], 'closer', v('RENOVACION'))?.id).toBe('r-renov');
    expect(elegirReglaDeColaborador([{ ...base, prioridad: 5 }, renovacionFija], 'closer', v('RENOVACION'))?.id).toBe('r-todas');
    expect(elegirReglaDeColaborador([base], 'otro', v('NUEVA'))).toBeNull();
  });

  it('regla FIJA del closer: cobra el monto y sale de la tajada del embajador', () => {
    const a = ajusteDeLaRegla(renovacionFija)!;
    expect(a).toEqual({ reglaId: 'r-renov', fijo: 4 });
    const filas = repartoDeComision({
      base: 68,
      cadena: { influencer: null, embajador: { id: 'emb' }, vendor: { id: 'closer' } },
      influencerPct: 0,
      embajadorPct: 25,
      vendorPctCrudo: 10,
      modo: 'DISCOUNT_FROM_INFLUENCER',
      fijos: { vendor: a.fijo },
      reglas: { vendor: a.reglaId },
    });
    expect(filas.map((f) => [f.recipientCodeId, f.amount, f.reglaId])).toEqual([
      ['emb', 13, 'r-renov'], // 17 − 4: su parte depende de la regla del closer
      ['closer', 4, 'r-renov'],
    ]);
  });

  it('sin fijos el reparto es idéntico al de siempre (ni un centavo movido)', () => {
    const args = {
      base: 278,
      cadena: { influencer: { id: 'inf' }, embajador: { id: 'emb' }, vendor: { id: 'ven' } },
      influencerPct: 5,
      embajadorPct: 25,
      vendorPctCrudo: 12.5,
      modo: 'DISCOUNT_FROM_INFLUENCER',
    };
    const sinNada = repartoDeComision(args);
    expect(repartoDeComision({ ...args, fijos: {}, reglas: {} })).toEqual(sinNada);
    expect(sinNada.every((f) => !('reglaId' in f))).toBe(true);
  });

  it('vigencia y filtros de la regla', () => {
    const r = { ...base, vigenteDesde: new Date('2026-11-01T05:00:00Z'), periodicidades: ['ANUAL'] };
    expect(coincideConLaVenta(r, { ...v('NUEVA'), periodicidad: 'ANUAL' })).toBe(false);
    expect(coincideConLaVenta(r, { fecha: new Date('2026-11-02'), tipo: 'NUEVA', periodicidad: 'ANUAL' })).toBe(true);
    expect(coincideConLaVenta(r, { fecha: new Date('2026-11-02'), tipo: 'NUEVA', periodicidad: 'MENSUAL' })).toBe(false);
  });
});
