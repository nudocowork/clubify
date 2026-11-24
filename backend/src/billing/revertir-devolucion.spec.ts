import { describe, it, expect } from 'vitest';
import { claveDelAjuste, revertirComisionesDeDevolucion } from './revertir-devolucion';

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
      findMany: async ({ where }: any) => ingresos.filter((i) => i.externalTxId === where.externalTxId),
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
