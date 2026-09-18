import { describe, it, expect } from 'vitest';
import {
  anularComisionesDeTransaccion,
  esDevolucion,
  fechaDelCobroDeHotmart,
  fueReactivada,
  motivoDeAnulacion,
  yaSePago,
} from './anular-comisiones-de-reembolso';

/**
 * Anular las comisiones de un pago que Hotmart devolvió.
 *
 * EL CASO REAL (Essentrix, 2026-09-18): pagó el 15-09, canceló la suscripción el
 * 17 y Hotmart le reembolsó el 18. El ingreso pasó a REEMBOLSADO; la comisión de
 * $15 del influencer siguió «Bloqueada», camino de pagarse el 30-09. Y en el mismo
 * negocio había OTRA comisión, de julio, YA PAGADA, que no se podía tocar.
 *
 * La regla: se anula lo de ESE pago que no se haya pagado; lo pagado se queda.
 *
 * El doble de la base APLICA el `where` de verdad —OR, in, notIn, lte, is null—.
 * Uno que devolviera siempre lo mismo haría pasar estas pruebas con la
 * condición de «ya pagada» rota o sin ella, que es exactamente el tipo de
 * candado que da verde sin mirar.
 */

type Fila = {
  id: string;
  externalTxId: string | null;
  hotmartTransactionId: string | null;
  status: string;
  paymentStatus: string;
  amountPaid: number;
  amount: number;
  payoutBatchId: string | null;
  payoutItem: { id: string } | null;
  notes: string | null;
  referralUse: { tenantId: string };
  businessDate: Date | null;
  createdAt: Date;
};

const OPERADORES = ['in', 'notIn', 'lte', 'gte', 'is', 'not'];

function cumple(f: any, w: any): boolean {
  if (!w) return true;
  return Object.entries(w).every(([k, v]: [string, any]) => {
    if (k === 'OR') return (v as any[]).some((x) => cumple(f, x));
    if (k === 'AND') return (v as any[]).every((x) => cumple(f, x));
    if (v === null) return f[k] == null;
    if (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      const ops = Object.keys(v).filter((o) => OPERADORES.includes(o));
      // Sin operadores es un filtro sobre una RELACIÓN: `referralUse: { tenantId }`.
      if (ops.length === 0) return f[k] != null && cumple(f[k], v);
      return ops.every((o) => {
        if (o === 'in') return v.in.includes(f[k]);
        if (o === 'notIn') return !v.notIn.includes(f[k]);
        // Como Postgres: un NULL no es mayor ni menor que nada.
        if (o === 'lte') return f[k] != null && Number(f[k]) <= Number(v.lte);
        if (o === 'gte') return f[k] != null && Number(f[k]) >= Number(v.gte);
        if (o === 'is') return v.is === null ? f[k] == null : f[k] != null;
        return f[k] !== v.not;
      });
    }
    return f[k] === v;
  });
}

function base(
  filas: Partial<Fila>[],
  cortes: Array<{ id: string; status: string; totalUsd?: number }> = [],
) {
  const com: Fila[] = filas.map((f, i) => ({
    id: `c${i + 1}`,
    externalTxId: null,
    hotmartTransactionId: null,
    status: 'PENDING',
    paymentStatus: 'PENDING',
    amountPaid: 0,
    amount: 15,
    payoutBatchId: null,
    payoutItem: null,
    notes: null,
    referralUse: { tenantId: 'essentrix' },
    businessDate: null,
    createdAt: new Date('2026-09-15T14:00:00Z'),
    ...f,
  }));
  const lotes = cortes.map((c) => ({ totalUsd: 0, ...c }));
  const db = {
    commission: {
      findMany: async ({ where }: any) => com.filter((f) => cumple(f, where)).map((f) => ({ ...f })),
      updateMany: async ({ where, data }: any) => {
        const tocadas = com.filter((f) => cumple(f, where));
        for (const f of tocadas) Object.assign(f, data);
        return { count: tocadas.length };
      },
      aggregate: async ({ where }: any) => ({
        _sum: {
          amount: com
            .filter((f) => f.payoutBatchId === where.payoutBatchId && f.status !== 'REJECTED')
            .reduce((a, f) => a + f.amount, 0),
        },
      }),
    },
    payoutBatch: {
      findMany: async ({ where }: any) => lotes.filter((l) => cumple(l, where)),
      update: async ({ where, data }: any) => Object.assign(lotes.find((l) => l.id === where.id)!, data),
    },
  };
  return { db, com, lotes };
}

const TX = 'HP3542288782';
const MOTIVO = motivoDeAnulacion('PURCHASE_REFUNDED', TX, new Date('2026-09-18T12:00:00Z'));

describe('el caso Essentrix', () => {
  it('anula la comisión del pago devuelto y deja intacta la de julio, ya pagada', async () => {
    const { db, com } = base([
      // La del 15-09: «Bloqueada», sin pagar, de la transacción devuelta.
      { externalTxId: TX },
      // La de julio: otra transacción, ya pagada en un corte.
      { externalTxId: 'HP1111727647', status: 'PAID', paymentStatus: 'PAID', amountPaid: 15 },
    ]);
    const r = await anularComisionesDeTransaccion(db as any, TX, MOTIVO);

    expect(r.anuladas).toBe(1);
    expect(com[0].status).toBe('REJECTED');
    expect(com[0].notes).toContain('Hotmart devolvió el pago');
    expect(com[1].status).toBe('PAID');
  });
});

describe('solo se anula lo que NO se ha pagado', () => {
  it('una comisión pagada entera se queda', async () => {
    const { db, com } = base([{ externalTxId: TX, status: 'PAID', paymentStatus: 'PAID', amountPaid: 15 }]);
    const r = await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(r).toMatchObject({ anuladas: 0, yaPagadas: 1 });
    expect(com[0].status).toBe('PAID');
  });

  it('un pago PARCIAL cuenta como pagada, aunque el status siga en APPROVED', async () => {
    // Es la trampa: con un pago parcial el status NO cambia a PAID. Mirar solo
    // el status la daría por anulable y se le retractaría lo ya cobrado.
    const { db, com } = base([{ externalTxId: TX, status: 'APPROVED', paymentStatus: 'PARTIAL', amountPaid: 5 }]);
    const r = await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(r.anuladas).toBe(0);
    expect(com[0].status).toBe('APPROVED');
  });

  it('una que ya está dentro de un desembolso se queda', async () => {
    const { db, com } = base([{ externalTxId: TX, status: 'APPROVED', payoutItem: { id: 'p1' } }]);
    await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(com[0].status).toBe('APPROVED');
  });

  it('APPROVED y RETENIDA sin pagar sí se anulan', async () => {
    const { db, com } = base([
      { externalTxId: TX, status: 'APPROVED' },
      { externalTxId: TX, status: 'RETAINED' },
    ]);
    const r = await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(r.anuladas).toBe(2);
    expect(com.every((c) => c.status === 'REJECTED')).toBe(true);
  });
});

describe('va por la transacción, no por «la última del afiliado»', () => {
  it('anula TODAS las filas de ese pago: directa, indirecta, socio y vendedor', async () => {
    // El código viejo anulaba solo `commissions[0]` de cada relación, y en el
    // reparto a tres las tres filas cuelgan de la misma: anulaba una de tres.
    const { db, com } = base([
      { externalTxId: TX },
      { externalTxId: TX },
      { externalTxId: TX, hotmartTransactionId: TX },
      { hotmartTransactionId: TX }, // grupo empresarial: solo este campo
    ]);
    const r = await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(r.anuladas).toBe(4);
    expect(com.every((c) => c.status === 'REJECTED')).toBe(true);
  });

  it('no toca comisiones de OTROS pagos del mismo negocio', async () => {
    const { db, com } = base([{ externalTxId: TX }, { externalTxId: 'HP-OTRO' }]);
    await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(com[1].status).toBe('PENDING');
  });

  it('no toca los asientos de ajuste', async () => {
    const { db, com } = base([{ externalTxId: TX, status: 'ADJUSTMENT', amount: -15 }]);
    await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(com[0].status).toBe('ADJUSTMENT');
  });
});

describe('seguro y repetible', () => {
  it('es idempotente: el mismo aviso otra vez no cambia nada', async () => {
    // Hotmart reenvía avisos, y el conciliador repasa los mismos cada noche.
    const { db, com } = base([{ externalTxId: TX, notes: null }]);
    await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    const nota = com[0].notes;
    const r2 = await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(r2.anuladas).toBe(0);
    expect(com[0].notes).toBe(nota); // sin la nota duplicada
  });

  it('si se paga justo entre leer y anular, NO se anula', async () => {
    // Leer-decidir-escribir: la condición de «anulable» va DENTRO del UPDATE.
    const { db, com } = base([{ externalTxId: TX }]);
    const findManyReal = db.commission.findMany;
    db.commission.findMany = async (args: any) => {
      const leidas = await findManyReal(args);
      // Alguien la paga en este instante, después de leerla.
      Object.assign(com[0], { status: 'PAID', paymentStatus: 'PAID', amountPaid: 15 });
      return leidas;
    };
    const r = await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(r.anuladas).toBe(0);
    expect(com[0].status).toBe('PAID');
  });

  it('añade el motivo a la nota que ya hubiera, no la pisa', async () => {
    const { db, com } = base([{ externalTxId: TX, notes: 'Cliente de la feria' }]);
    await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(com[0].notes).toContain('Cliente de la feria');
    expect(com[0].notes).toContain('Hotmart devolvió el pago');
  });
});

describe('los cortes', () => {
  it('la saca de un corte ABIERTO y le rehace el total', async () => {
    const { db, com, lotes } = base(
      [
        { externalTxId: TX, status: 'APPROVED', payoutBatchId: 'b1', amount: 15 },
        { externalTxId: 'HP-OTRO', status: 'APPROVED', payoutBatchId: 'b1', amount: 40 },
      ],
      [{ id: 'b1', status: 'OPEN' }],
    );
    const r = await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(com[0].payoutBatchId).toBeNull();
    expect(lotes[0].totalUsd).toBe(40);
    expect(r.cortesRecalculados).toBe(1);
  });

  it('un corte CERRADO no se toca', async () => {
    // Con un total que NO es el que saldría de recalcular: si se tocara, cambiaría.
    const { db, com, lotes } = base(
      [{ externalTxId: TX, status: 'APPROVED', payoutBatchId: 'b2' }],
      [{ id: 'b2', status: 'CLOSED', totalUsd: 99 }],
    );
    const r = await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(r.cortesRecalculados).toBe(0);
    expect(lotes[0].totalUsd).toBe(99);
    expect(com[0].payoutBatchId).toBe('b2');
  });
});

describe('lo que alguien reactivó a mano se respeta', () => {
  it('una anulada por ESTA devolución y vuelta a poner viva no se re-anula', async () => {
    // El conciliador repasa todas las devoluciones cada noche. Sin esta guarda,
    // si Sara la reactiva (un contracargo que Hotmart resolvió a favor), a las
    // 4:00 volvía a REJECTED, en silencio, noche tras noche.
    const { db, com } = base([{ externalTxId: TX, status: 'APPROVED', notes: MOTIVO }]);
    const r = await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(r).toMatchObject({ anuladas: 0, reactivadas: 1 });
    expect(com[0].status).toBe('APPROVED');
  });

  it('la nota de OTRA devolución no la protege', async () => {
    const otra = motivoDeAnulacion('PURCHASE_REFUNDED', 'HP-OTRO');
    const { db, com } = base([{ externalTxId: TX, notes: otra }]);
    await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(com[0].status).toBe('REJECTED');
    expect(fueReactivada(otra, TX)).toBe(false);
    expect(fueReactivada(MOTIVO, TX)).toBe(true);
  });
});

describe('comisiones que nacieron SIN transacción', () => {
  // Las repone el cron de renovaciones cuando el aviso no las generó: llevan en
  // `businessDate` la fecha exacta del cobro y ninguna transacción. En
  // producción eran 10 de 33 vivas.
  const COBRO = new Date('2026-09-15T14:00:00Z');
  const sinTx = (f: Partial<Fila> = {}): Partial<Fila> => ({ businessDate: COBRO, ...f });

  it('sin negocio ni fecha del cobro, NO se tocan: solo se va por transacción', async () => {
    const { db, com } = base([sinTx()]);
    const r = await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(r.anuladas).toBe(0);
    expect(com[0].status).toBe('PENDING');
  });

  it('con el negocio y la fecha del cobro, la de ESE cobro se anula', async () => {
    const { db, com } = base([sinTx()]);
    const r = await anularComisionesDeTransaccion(db as any, TX, MOTIVO, {
      tenantId: 'essentrix',
      fechaDelCobro: COBRO,
    });
    expect(r.anuladas).toBe(1);
    expect(com[0].status).toBe('REJECTED');
  });

  it('la del cobro de OTRO mes del mismo negocio se queda', async () => {
    const { db, com } = base([sinTx({ businessDate: new Date('2026-08-15T14:00:00Z') })]);
    await anularComisionesDeTransaccion(db as any, TX, MOTIVO, {
      tenantId: 'essentrix',
      fechaDelCobro: COBRO,
    });
    expect(com[0].status).toBe('PENDING');
  });

  it('la de OTRO negocio con la misma fecha se queda', async () => {
    const { db, com } = base([sinTx({ referralUse: { tenantId: 'otro' } })]);
    await anularComisionesDeTransaccion(db as any, TX, MOTIVO, {
      tenantId: 'essentrix',
      fechaDelCobro: COBRO,
    });
    expect(com[0].status).toBe('PENDING');
  });

  it('una sin fecha de negocio se queda: no se puede saber de qué cobro es', async () => {
    const { db, com } = base([{ businessDate: null }]);
    await anularComisionesDeTransaccion(db as any, TX, MOTIVO, {
      tenantId: 'essentrix',
      fechaDelCobro: COBRO,
    });
    expect(com[0].status).toBe('PENDING');
  });

  it('una que lleva OTRA transacción no entra por fecha', async () => {
    const { db, com } = base([sinTx({ externalTxId: 'HP-OTRO' })]);
    await anularComisionesDeTransaccion(db as any, TX, MOTIVO, {
      tenantId: 'essentrix',
      fechaDelCobro: COBRO,
    });
    expect(com[0].status).toBe('PENDING');
  });
});

describe('con la transacción, pero de otro ciclo', () => {
  it('se informa y NO se anula', async () => {
    // El relleno de comisiones estampa la ÚLTIMA transacción de Hotmart del
    // negocio aunque el ciclo lo haya pagado por fuera: esa comisión lleva la tx
    // devuelta sin ser de ese cobro.
    const { db, com } = base([
      { externalTxId: TX, businessDate: new Date('2026-11-20T00:00:00Z') },
    ]);
    const r = await anularComisionesDeTransaccion(db as any, TX, MOTIVO, {
      tenantId: 'essentrix',
      fechaDelCobro: new Date('2026-09-15T14:00:00Z'),
    });
    expect(r).toMatchObject({ anuladas: 0, deOtroCiclo: 1 });
    expect(com[0].status).toBe('PENDING');
  });

  it('sin fecha del cobro no se puede comparar: se anula por transacción', async () => {
    const { db, com } = base([
      { externalTxId: TX, businessDate: new Date('2026-11-20T00:00:00Z') },
    ]);
    await anularComisionesDeTransaccion(db as any, TX, MOTIVO);
    expect(com[0].status).toBe('REJECTED');
  });
});

describe('simulación', () => {
  it('dice lo que haría y no escribe nada', async () => {
    const { db, com } = base([
      { externalTxId: TX, amount: 15 },
      { externalTxId: TX, status: 'PAID', paymentStatus: 'PAID', amountPaid: 7.5, amount: 7.5 },
    ]);
    const r = await anularComisionesDeTransaccion(db as any, TX, MOTIVO, { simular: true });
    expect(r.detalle).toEqual([
      { id: 'c1', monto: 15, que: 'anulada' },
      { id: 'c2', monto: 7.5, que: 'pagada' },
    ]);
    expect(com[0].status).toBe('PENDING');
    expect(com[0].notes).toBeNull();
  });
});

describe('la fecha del cobro que trae Hotmart', () => {
  it('entiende milisegundos, como número o como texto', () => {
    const ms = Date.UTC(2026, 8, 15, 14);
    expect(fechaDelCobroDeHotmart(ms)?.toISOString()).toBe('2026-09-15T14:00:00.000Z');
    expect(fechaDelCobroDeHotmart(String(ms))?.toISOString()).toBe('2026-09-15T14:00:00.000Z');
  });

  it('sin fecha o con basura devuelve null, y entonces solo se va por transacción', () => {
    expect(fechaDelCobroDeHotmart(undefined)).toBeNull();
    expect(fechaDelCobroDeHotmart('')).toBeNull();
    expect(fechaDelCobroDeHotmart('no es fecha')).toBeNull();
  });
});

describe('qué cuenta como devolución', () => {
  it('reembolso y contracargo sí', () => {
    expect(esDevolucion('PURCHASE_REFUNDED')).toBe(true);
    expect(esDevolucion('PURCHASE_CHARGEBACK')).toBe(true);
  });

  it('una DISPUTA no: se puede ganar', () => {
    // Essentrix tuvo un PURCHASE_PROTEST antes del reembolso: si la disputa ya
    // anulara, un cliente que la pierde dejaría al afiliado sin su comisión.
    expect(esDevolucion('PURCHASE_PROTEST')).toBe(false);
    expect(esDevolucion('SUBSCRIPTION_CANCELLATION')).toBe(false);
    expect(esDevolucion(null)).toBe(false);
  });
});

describe('«ya se pagó»', () => {
  it('basta cualquiera de las señales', () => {
    const vacia = { status: 'APPROVED', paymentStatus: 'PENDING', amountPaid: 0 };
    expect(yaSePago(vacia)).toBe(false);
    expect(yaSePago({ ...vacia, status: 'PAID' })).toBe(true);
    expect(yaSePago({ ...vacia, paymentStatus: 'PAID' })).toBe(true);
    expect(yaSePago({ ...vacia, paymentStatus: 'PARTIAL' })).toBe(true);
    expect(yaSePago({ ...vacia, amountPaid: 0.01 })).toBe(true);
    expect(yaSePago({ ...vacia, payoutItem: { id: 'x' } })).toBe(true);
  });
});
