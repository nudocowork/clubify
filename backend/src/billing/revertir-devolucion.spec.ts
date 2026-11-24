import { describe, it, expect } from 'vitest';
import { claveDelAjuste, elegirPagoSustituto, revertirComisionesDeDevolucion } from './revertir-devolucion';

/**
 * Reversión de comisiones de un pago devuelto (Javier, 2026-11-23).
 *
 * Caso guía: Protein Station. Renovación trimestral HP0032012122 del 23-oct
 * ($150), disputa el 23-nov. La comisión de $7,50 del influencer ya se había
 * pagado en el corte del 15-nov.
 */

const TX = 'HP0032012122';
const COBRO = new Date('2026-10-23T13:28:48.000Z');
const AHORA = new Date('2026-11-23T22:00:00.000Z');

type Fila = Record<string, any>;

/**
 * Base falsa con lo justo que usa la reversión. El `create` imita el índice
 * único parcial sobre `periodKey` (DEVOL-…): el segundo intento choca con P2002.
 */
function baseFalsa(opts: { comisiones: Fila[]; ajustes?: Record<string, string>; ingresos?: Fila[] }) {
  const com: Fila[] = opts.comisiones.map((c, i) => ({
    id: `c${i + 1}`,
    status: 'APPROVED',
    paymentStatus: 'PENDING',
    amountPaid: 0,
    payoutBatchId: null,
    payoutItem: null,
    notes: null,
    externalTxId: null,
    hotmartTransactionId: null,
    businessDate: COBRO,
    createdAt: COBRO,
    referralUseId: 'use-1',
    recipientCodeId: 'rc-influencer',
    businessGroupId: null,
    periodKey: null,
    referralUse: { tenantId: 't-protein' },
    ...c,
  }));
  const settings = opts.ajustes ?? {};
  const ingresos = opts.ingresos ?? [
    { id: 'ing-1', externalTxId: TX, saleDate: COBRO, grossUsd: 150, netExpectedUsd: 130, payerWhiteLabelId: null },
  ];
  const coincide = (c: Fila, w: any): boolean => {
    if (!w) return true;
    for (const [k, v] of Object.entries(w)) {
      if (k === 'OR') {
        if (!(v as any[]).some((x) => coincide(c, x))) return false;
      } else if (k === 'referralUse') {
        if (c.referralUse?.tenantId !== (v as any).tenantId) return false;
      } else if (k === 'payoutItem') {
        if ((v as any)?.is === null && c.payoutItem) return false;
      } else if (k === 'businessDate') {
        const t = (c.businessDate as Date).getTime();
        if ((v as any).gte && t < (v as any).gte.getTime()) return false;
        if ((v as any).lte && t > (v as any).lte.getTime()) return false;
      } else if (v && typeof v === 'object' && 'in' in (v as any)) {
        if (!(v as any).in.includes(c[k])) return false;
      } else if (v && typeof v === 'object' && 'notIn' in (v as any)) {
        if ((v as any).notIn.includes(c[k])) return false;
      } else if (v && typeof v === 'object' && 'lte' in (v as any)) {
        if (!(Number(c[k]) <= (v as any).lte)) return false;
      } else if (c[k] !== v) return false;
    }
    return true;
  };
  const db: any = {
    commission: {
      findMany: async ({ where }: any) => com.filter((c) => coincide(c, where)),
      findFirst: async ({ where }: any) => com.find((c) => coincide(c, where)) ?? null,
      updateMany: async ({ where, data }: any) => {
        const t = com.filter((c) => coincide(c, where));
        for (const c of t) Object.assign(c, data);
        return { count: t.length };
      },
      aggregate: async () => ({ _sum: { amount: 0 } }),
      create: async ({ data }: any) => {
        if (com.some((c) => c.periodKey === data.periodKey)) {
          throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        }
        const fila = { id: `aj${com.length + 1}`, ...data };
        com.push(fila);
        return fila;
      },
    },
    payoutBatch: { findMany: async () => [], update: async () => null },
    setting: { findUnique: async ({ where }: any) => (where.key in settings ? { value: settings[where.key] } : null) },
    whiteLabel: { findFirst: async () => ({ id: 'wl-clubify' }) },
    incomeRecord: {
      findFirst: async ({ where }: any) => ingresos.find((i) => i.externalTxId === where.externalTxId) ?? null,
      findMany: async ({ where }: any) => {
        // Búsqueda de un pago sustituto: mismo negocio, PAGADO, otra tx, ventana de fechas.
        if (where.tenantId) {
          return ingresos.filter(
            (i) =>
              i.tenantId === where.tenantId &&
              i.status === where.status &&
              i.externalTxId !== where.externalTxId.not &&
              i.saleDate >= where.saleDate.gte &&
              i.saleDate <= where.saleDate.lte,
          );
        }
        return ingresos.filter((i) => i.externalTxId === where.externalTxId);
      },
      count: async () => 1,
    },
  };
  return { db, com };
}

const ajustesDe = (com: Fila[]) => com.filter((c) => c.status === 'ADJUSTMENT');

describe('comisión de venta (closer, influencer…)', () => {
  it('NO pagada → se anula y deja de estar pendiente', async () => {
    const { db, com } = baseFalsa({ comisiones: [{ externalTxId: TX, amount: 7.5 }] });
    const r = await revertirComisionesDeDevolucion(db, { tx: TX, tipo: 'REEMBOLSO', motivo: 'm', tenantId: 't-protein', fechaDelCobro: COBRO, cuando: AHORA });
    expect(com[0].status).toBe('REJECTED');
    expect(r.anulacion.anuladas).toBe(1);
    expect(ajustesDe(com)).toHaveLength(0);
  });

  it('YA pagada → la original queda intacta y nace un ajuste negativo por recuperar', async () => {
    const { db, com } = baseFalsa({
      comisiones: [{ externalTxId: TX, amount: 7.5, status: 'PAID', paymentStatus: 'PAID', amountPaid: 7.5 }],
    });
    const r = await revertirComisionesDeDevolucion(db, { tx: TX, tipo: 'DISPUTA', motivo: 'm', tenantId: 't-protein', fechaDelCobro: COBRO, cuando: AHORA });
    // Historial intacto: la comisión pagada sigue PAGADA.
    expect(com[0].status).toBe('PAID');
    const [aj] = ajustesDe(com);
    expect(aj).toMatchObject({
      amount: -7.5,
      status: 'ADJUSTMENT',
      paymentStatus: 'PENDING',
      recipientCodeId: 'rc-influencer',
      periodKey: claveDelAjuste(TX, 'c1'),
      externalTxId: TX,
    });
    // El motivo y la transacción que lo originó quedan escritos.
    expect(aj.notes).toContain('disputa del pago HP0032012122');
    expect(aj.notes).toContain('se descuenta del siguiente corte');
    expect(r.ajustes).toEqual([
      expect.objectContaining({ comisionId: 'c1', montoUsd: 7.5, origen: 'VENTA', resultado: 'creado' }),
    ]);
  });

  it('una pagada A MEDIAS recupera solo lo que salió', async () => {
    const { db, com } = baseFalsa({
      comisiones: [{ externalTxId: TX, amount: 15, paymentStatus: 'PARTIAL', amountPaid: 5 }],
    });
    await revertirComisionesDeDevolucion(db, { tx: TX, tipo: 'REEMBOLSO', motivo: 'm', cuando: AHORA });
    expect(ajustesDe(com)[0].amount).toBe(-5);
  });

  it('dos avisos del MISMO reembolso no duplican nada', async () => {
    const { db, com } = baseFalsa({
      comisiones: [
        { externalTxId: TX, amount: 15 },
        { externalTxId: TX, amount: 7.5, status: 'PAID', paymentStatus: 'PAID', amountPaid: 7.5, recipientCodeId: 'rc-closer' },
      ],
    });
    const args = { tx: TX, tipo: 'REEMBOLSO' as const, motivo: 'm', tenantId: 't-protein', fechaDelCobro: COBRO, cuando: AHORA };
    await revertirComisionesDeDevolucion(db, args);
    const segunda = await revertirComisionesDeDevolucion(db, args);
    expect(ajustesDe(com)).toHaveLength(1);
    expect(segunda.anulacion.anuladas).toBe(0);
    expect(segunda.ajustes).toEqual([expect.objectContaining({ resultado: 'yaExistia' })]);
  });

  it('una pagada de OTRO ciclo con la misma transacción no se le descuenta a nadie', async () => {
    // El relleno de comisiones estampa la última transacción del negocio aunque
    // el ciclo sea otro (ver `LEJOS_DEL_COBRO`).
    const { db, com } = baseFalsa({
      comisiones: [
        {
          externalTxId: TX,
          amount: 7.5,
          status: 'PAID',
          paymentStatus: 'PAID',
          amountPaid: 7.5,
          businessDate: new Date('2026-07-23T17:00:00.000Z'),
        },
      ],
    });
    const r = await revertirComisionesDeDevolucion(db, { tx: TX, tipo: 'REEMBOLSO', motivo: 'm', fechaDelCobro: COBRO, cuando: AHORA });
    expect(ajustesDe(com)).toHaveLength(0);
    expect(r.anulacion.deOtroCiclo).toBe(1);
  });

  it('solo toca las comisiones de ESA transacción', async () => {
    const { db, com } = baseFalsa({
      comisiones: [
        { externalTxId: TX, amount: 7.5 },
        { externalTxId: 'HP-OTRA', amount: 9 },
      ],
    });
    await revertirComisionesDeDevolucion(db, { tx: TX, tipo: 'REEMBOLSO', motivo: 'm', cuando: AHORA });
    expect(com[1].status).toBe('APPROVED');
  });
});

describe('Project Manager (2 % de la quincena) y socio (10 % del mes)', () => {
  const ajustes = {
    'comisiones.equipo.codeId': 'rc-sara',
    'comisiones.equipo.porcentaje': '2',
    'comisiones.equipo.desde': '2026-09-16',
    'comisiones.socio.codeId': 'rc-socio',
    'comisiones.socio.desde': '2026-10',
    'contabilidad.socio.porcentaje': '10',
  };

  it('quincena SIN pagar → nada que hacer: su cron la recalcula sin el ingreso devuelto', async () => {
    const { db, com } = baseFalsa({
      comisiones: [{ recipientCodeId: 'rc-sara', referralUseId: null, periodKey: 'EQUIPO-2026-10-31', amount: 40 }],
      ajustes,
    });
    const r = await revertirComisionesDeDevolucion(db, { tx: TX, tipo: 'REEMBOLSO', motivo: 'm', cuando: AHORA });
    expect(ajustesDe(com)).toHaveLength(0);
    expect(r.equipo).toMatch(/se recalcula sola/);
  });

  it('quincena YA pagada → ajuste por el 2 % de ese cobro', async () => {
    const { db, com } = baseFalsa({
      comisiones: [
        { recipientCodeId: 'rc-sara', referralUseId: null, periodKey: 'EQUIPO-2026-10-31', amount: 40, status: 'PAID', paymentStatus: 'PAID', amountPaid: 40 },
      ],
      ajustes,
    });
    await revertirComisionesDeDevolucion(db, { tx: TX, tipo: 'CONTRACARGO', motivo: 'm', cuando: AHORA });
    const [aj] = ajustesDe(com);
    // 2 % de $150 = $3.
    expect(aj).toMatchObject({ amount: -3, recipientCodeId: 'rc-sara', status: 'ADJUSTMENT' });
    expect(aj.notes).toContain('contracargo');
  });

  it('mes del socio YA pagado → ajuste por su 10 % (sobre el neto desde octubre)', async () => {
    const { db, com } = baseFalsa({
      comisiones: [
        { recipientCodeId: 'rc-socio', referralUseId: null, periodKey: 'SOCIO-2026-10', amount: 200, status: 'PAID', paymentStatus: 'PAID', amountPaid: 200 },
      ],
      ajustes,
    });
    await revertirComisionesDeDevolucion(db, { tx: TX, tipo: 'REEMBOLSO', motivo: 'm', cuando: AHORA });
    // Octubre ya va por el NETO: 10 % de $130 = $13.
    expect(ajustesDe(com)[0]).toMatchObject({ amount: -13, recipientCodeId: 'rc-socio' });
  });

  it('simular no escribe nada', async () => {
    const { db, com } = baseFalsa({
      comisiones: [
        { externalTxId: TX, amount: 7.5, status: 'PAID', paymentStatus: 'PAID', amountPaid: 7.5 },
        { recipientCodeId: 'rc-sara', referralUseId: null, periodKey: 'EQUIPO-2026-10-31', amount: 40, status: 'PAID', paymentStatus: 'PAID', amountPaid: 40 },
      ],
      ajustes,
    });
    const r = await revertirComisionesDeDevolucion(db, { tx: TX, tipo: 'REEMBOLSO', motivo: 'm', cuando: AHORA, simular: true });
    expect(ajustesDe(com)).toHaveLength(0);
    expect(r.ajustes.map((a) => a.resultado)).toEqual(['simulado', 'simulado']);
  });
});

/**
 * PAGO SUSTITUTO — caso Drive Pizza (2026-11-24). Anual de $500 por Hotmart
 * (HP2009265423, 24-ago), comisiones de Nicolás ($100) y Samuel ($25) pagadas;
 * el banco lo reembolsó el 10-oct y el cliente pagó otra vez a mano, con la
 * fecha y el monto del cobro original. La pasada nocturna del 24-11 creó
 * descuentos de −$100 y −$25 como si nadie hubiera pagado.
 */
describe('cobro devuelto con un pago que lo sustituye (Drive Pizza)', () => {
  const HP = 'HP2009265423';
  const AGO = new Date('2026-08-24T21:52:00.000Z');
  const MANUAL = '6898628a-8b68-4605-b729-4b83e9bb683e';
  const ingresosDrive = [
    { id: 'ing-hp', tenantId: 't-drive', externalTxId: HP, gateway: 'HOTMART', saleDate: AGO, grossUsd: 500, status: 'REEMBOLSADO', category: 'RENOVACION' },
    { id: 'ing-man', tenantId: 't-drive', externalTxId: MANUAL, gateway: 'MANUAL', saleDate: AGO, grossUsd: 500, status: 'PAGADO', category: 'RENOVACION' },
  ];
  const pagadas = () => [
    { externalTxId: null, amount: 100, status: 'PAID', paymentStatus: 'PAID', amountPaid: 100, recipientCodeId: 'rc-nicolas', businessDate: AGO, referralUse: { tenantId: 't-drive' } },
    { hotmartTransactionId: HP, externalTxId: HP, amount: 25, status: 'PAID', paymentStatus: 'PAID', amountPaid: 25, recipientCodeId: 'rc-samuel', businessDate: AGO, referralUse: { tenantId: 't-drive' } },
  ];
  const args = { tx: HP, tipo: 'REEMBOLSO' as const, motivo: 'm', tenantId: 't-drive', fechaDelCobro: AGO, cuando: AHORA };

  it('no crea descuentos: las comisiones pagadas pasan al pago manual', async () => {
    const { db, com } = baseFalsa({ comisiones: pagadas(), ingresos: ingresosDrive });
    const r = await revertirComisionesDeDevolucion(db, args);
    expect(ajustesDe(com)).toHaveLength(0);
    expect(r.sustituto?.externalTxId).toBe(MANUAL);
    expect(r.traspasadas).toEqual([
      { id: 'c1', monto: 100, pagada: true },
      { id: 'c2', monto: 25, pagada: true },
    ]);
    // Siguen pagadas UNA vez, ahora vinculadas al pago manual y sin la tx devuelta.
    for (const c of com) {
      expect(c).toMatchObject({ status: 'PAID', ingresoId: 'ing-man', externalTxId: null, hotmartTransactionId: null });
      expect(c.notes).toContain('Pasa al pago');
      expect(c.notes).toContain(HP);
    }
  });

  it('anula los descuentos pendientes creados antes de saberlo, y es idempotente', async () => {
    const { db, com } = baseFalsa({
      comisiones: [
        ...pagadas(),
        { status: 'ADJUSTMENT', paymentStatus: 'PENDING', amount: -100, externalTxId: HP, periodKey: `DEVOL-${HP}-c1`, recipientCodeId: 'rc-nicolas' },
        { status: 'ADJUSTMENT', paymentStatus: 'PENDING', amount: -25, externalTxId: HP, periodKey: `DEVOL-${HP}-c2`, recipientCodeId: 'rc-samuel' },
      ],
      ingresos: ingresosDrive,
    });
    const r = await revertirComisionesDeDevolucion(db, args);
    expect(r.ajustesAnulados).toEqual([
      { id: 'c3', montoUsd: 100 },
      { id: 'c4', montoUsd: 25 },
    ]);
    // El historial queda: el descuento no se borra, se anula con su porqué.
    expect(com[2].status).toBe('REJECTED');
    expect(com[2].notes).toContain('pago sustituto');
    const notas = com.map((c) => c.notes);

    // La pasada de la noche siguiente no cambia nada.
    const r2 = await revertirComisionesDeDevolucion(db, args);
    expect(r2.ajustesAnulados).toEqual([]);
    expect(com.map((c) => c.notes)).toEqual(notas);
  });

  it('un descuento YA aplicado en un corte no se toca: se informa para devolverlo a mano', async () => {
    const { db, com } = baseFalsa({
      comisiones: [
        ...pagadas(),
        { status: 'ADJUSTMENT', paymentStatus: 'PAID', amount: -100, externalTxId: HP, periodKey: `DEVOL-${HP}-c1`, recipientCodeId: 'rc-nicolas' },
      ],
      ingresos: ingresosDrive,
    });
    const r = await revertirComisionesDeDevolucion(db, args);
    expect(r.ajustesYaDescontados).toEqual(['c3']);
    expect(com[2].status).toBe('ADJUSTMENT');
  });

  it('una comisión SIN pagar tampoco se anula: es la del pago que sí entró', async () => {
    const { db, com } = baseFalsa({
      comisiones: [{ externalTxId: HP, hotmartTransactionId: HP, amount: 100, recipientCodeId: 'rc-nicolas', businessDate: AGO, referralUse: { tenantId: 't-drive' } }],
      ingresos: ingresosDrive,
    });
    const r = await revertirComisionesDeDevolucion(db, args);
    expect(com[0].status).toBe('APPROVED');
    expect(r.anulacion.anuladas).toBe(0);
    expect(r.traspasadas).toEqual([{ id: 'c1', monto: 100, pagada: false }]);
  });

  it('simular no escribe nada', async () => {
    const { db, com } = baseFalsa({ comisiones: pagadas(), ingresos: ingresosDrive });
    const r = await revertirComisionesDeDevolucion(db, { ...args, simular: true });
    expect(r.traspasadas).toHaveLength(2);
    expect(com[0].notes).toBeNull();
    expect(com[1].hotmartTransactionId).toBe(HP);
  });
});

describe('elegirPagoSustituto', () => {
  const D = new Date('2026-08-24T12:00:00.000Z');
  const dev = { externalTxId: 'HP1', saleDate: D, grossUsd: 500 };
  const base = { id: 'x', externalTxId: 'M1', gateway: 'MANUAL', saleDate: D, grossUsd: 500, status: 'PAGADO', category: 'RENOVACION' };
  const dias = (n: number) => new Date(D.getTime() + n * 86_400_000);

  it('el mismo período pagado de nuevo cuenta', () => {
    expect(elegirPagoSustituto(dev, [base])?.externalTxId).toBe('M1');
  });
  it('lejos en fecha NO: es otro período (Protein Station renovó 3 meses antes)', () => {
    expect(elegirPagoSustituto(dev, [{ ...base, saleDate: dias(-92) }])).toBeNull();
    expect(elegirPagoSustituto(dev, [{ ...base, saleDate: dias(4) }])).toBeNull();
  });
  it('un upgrade, un ingreso OTRO, un monto menor o un cobro no pagado NO sustituyen', () => {
    expect(elegirPagoSustituto(dev, [{ ...base, category: 'UPGRADE' }])).toBeNull();
    expect(elegirPagoSustituto(dev, [{ ...base, category: 'OTRO' }])).toBeNull();
    expect(elegirPagoSustituto(dev, [{ ...base, grossUsd: 150 }])).toBeNull();
    expect(elegirPagoSustituto(dev, [{ ...base, status: 'REEMBOLSADO' }])).toBeNull();
  });
  it('el propio cobro devuelto no se sustituye a sí mismo', () => {
    expect(elegirPagoSustituto(dev, [{ ...base, externalTxId: 'HP1' }])).toBeNull();
  });
  it('cobro doble de Hotmart: el que se quedó sustituye al reembolsado', () => {
    const s = elegirPagoSustituto(dev, [{ ...base, externalTxId: 'HP2', gateway: 'HOTMART', saleDate: dias(0.01) }]);
    expect(s?.gateway).toBe('HOTMART');
  });
});
