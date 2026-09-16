import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { CutoffService } from './cutoff.service';

/**
 * EL MOVIMIENTO DE PAGO Y SU COMPROBANTE
 *
 * El comprobante de una transferencia se guarda en la fila (corte, persona) de
 * `BatchPersonPayment`, que es el movimiento: 11 comisiones pagadas de un giro
 * son UNA fila con UNA URL. Esa fila la escriben dos caminos distintos —el pago
 * en bloque y el «Marcar pagado» de cada persona— y la deshace un tercero
 * (revertir). Aquí se prueba que los tres no se pisan, porque cada forma de
 * pisarse termina en lo mismo: un comprobante que dice algo que no pasó.
 *
 * Se corre contra una base FALSA en memoria (sin Postgres): lo que importa es
 * la coreografía entre lectura, escritura condicional y `upsert`, no el SQL.
 * La transacción falsa revierte todo si algo lanza, como la de verdad.
 */

const BUCKET = 'https://pub-test.r2.dev';
const COMPROBANTE_A = `${BUCKET}/payout-proofs/primero.pdf`;
const COMPROBANTE_B = `${BUCKET}/payout-proofs/segundo.pdf`;
const ADMIN = { id: 'admin-1', role: 'SUPER_ADMIN' } as any;
const FECHA = '2026-09-16';

const round2 = (n: number) => Math.round(n * 100) / 100;

type Comision = {
  id: string;
  amount: number;
  amountPaid: number;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';
  paymentStatus: 'PENDING' | 'PARTIAL' | 'PAID';
  payoutBatchId: string | null;
  recipientCodeId: string | null;
  notes: string | null;
  paidAt: Date | null;
};

/** ¿El valor de la fila cumple la condición del `where` de Prisma? */
function coincide(valor: any, cond: any): boolean {
  if (cond === undefined) return true;
  if (cond === null) return valor === null;
  if (cond && typeof cond === 'object') {
    if ('in' in cond) return (cond.in as any[]).includes(valor);
    if ('not' in cond)
      return cond.not === null ? valor !== null : valor !== cond.not;
  }
  return valor === cond;
}

/** Base en memoria con lo justo que tocan estos tres métodos. */
class BaseFalsa {
  comisiones = new Map<string, Comision>();
  movimientos = new Map<string, any>();
  lotes = new Map<string, any>([
    ['B', { id: 'B', code: 'CORTE-2026-09-15', status: 'OPEN', totalUsd: 0 }],
  ]);
  /** Gancho para simular al OTRO admin: corre justo después de cada lectura. */
  alLeerComisiones: (() => void) | null = null;
  /**
   * Ídem, pero justo después de LEER un movimiento — que es el punto que las
   * dos versiones (la buena y la rota) tienen en común. Si el gancho colgara
   * del decremento, la versión rota —que no decrementa— nunca lo dispararía y
   * el rojo saldría por el motivo equivocado.
   */
  alLeerMovimiento: (() => void) | null = null;

  constructor(comisiones: Comision[]) {
    for (const c of comisiones) this.comisiones.set(c.id, c);
  }

  movimiento(batchId: string, recipientCodeId: string) {
    return this.movimientos.get(`${batchId}|${recipientCodeId}`);
  }

  /** El otro admin pagó la misma selección mientras leíamos. */
  pagarPorFuera(ids: string[]) {
    for (const id of ids) {
      const c = this.comisiones.get(id);
      if (!c) continue;
      c.status = 'PAID';
      c.paymentStatus = 'PAID';
      c.amountPaid = c.amount;
    }
  }

  commission = {
    findMany: async ({ where }: any) => {
      const filas = [...this.comisiones.values()]
        .filter(
          (c) =>
            coincide(c.id, where.id) &&
            coincide(c.status, where.status) &&
            coincide(c.paymentStatus, where.paymentStatus) &&
            coincide(c.payoutBatchId, where.payoutBatchId) &&
            coincide(c.recipientCodeId, where.recipientCodeId),
        )
        .map((c) => ({
          ...c,
          payoutBatch: c.payoutBatchId
            ? this.lotes.get(c.payoutBatchId)
            : null,
          recipientCode: { ownerName: 'Nicolás Quintero' },
        }));
      // Después de materializar la lectura, no antes: el servicio ya se llevó
      // su foto y a partir de acá la base puede haber cambiado.
      this.alLeerComisiones?.();
      return filas;
    },
    updateMany: async ({ where, data }: any) => {
      const filas = [...this.comisiones.values()].filter(
        (c) => coincide(c.id, where.id) && coincide(c.status, where.status),
      );
      for (const c of filas) Object.assign(c, data);
      return { count: filas.length };
    },
    // Existe para que la versión SIN el update condicional también corra (es lo
    // que se rompe a propósito para ver el test en rojo).
    update: async ({ where, data }: any) => {
      const c = this.comisiones.get(where.id);
      if (c) Object.assign(c, data);
      return c;
    },
    aggregate: async ({ where }: any) => {
      const suma = [...this.comisiones.values()]
        .filter(
          (c) =>
            c.payoutBatchId === where.payoutBatchId &&
            c.status !== 'REJECTED',
        )
        .reduce((s, c) => s + c.amount, 0);
      return { _sum: { amount: suma } };
    },
  };

  payoutBatch = {
    findUnique: async ({ where }: any) => this.lotes.get(where.id) ?? null,
    findFirst: async () =>
      [...this.lotes.values()].find((l) => l.status === 'OPEN') ?? null,
    update: async ({ where, data }: any) => {
      const l = this.lotes.get(where.id);
      if (l) Object.assign(l, data);
      return l;
    },
  };

  referralCode = {
    findUnique: async () => ({ ownerName: 'Nicolás Quintero' }),
  };

  batchPersonPayment = {
    findUnique: async ({ where }: any) => {
      // COPIA: el gancho de abajo muta la fila guardada, y quien leyó tiene que
      // quedarse con la foto vieja — si no, «leer» devolvería ya el cambio del
      // otro admin y no habría carrera que probar.
      const fila = this.movimientos.get(claveDe(where));
      const copia = fila ? { ...fila } : null;
      this.alLeerMovimiento?.();
      return copia;
    },
    findMany: async ({ where }: any) =>
      [...this.movimientos.values()].filter((f) => coincideMovimiento(f, where)),
    upsert: async ({ where, update, create }: any) => {
      const k = claveDe(where);
      const actual = this.movimientos.get(k);
      if (!actual) {
        this.movimientos.set(k, { ...create });
        return this.movimientos.get(k);
      }
      const data = { ...update };
      if (data.amountUsd?.increment !== undefined) {
        data.amountUsd = round2(actual.amountUsd + data.amountUsd.increment);
      }
      this.movimientos.set(k, { ...actual, ...data });
      return this.movimientos.get(k);
    },
    updateMany: async ({ where, data }: any) => {
      const filas = [...this.movimientos.entries()].filter(([, f]) =>
        coincideMovimiento(f, where),
      );
      for (const [k, f] of filas) {
        const nuevo: any = { ...f, ...data };
        if (data.amountUsd?.decrement !== undefined) {
          nuevo.amountUsd = round2(f.amountUsd - data.amountUsd.decrement);
        } else if (data.amountUsd?.increment !== undefined) {
          nuevo.amountUsd = round2(f.amountUsd + data.amountUsd.increment);
        }
        this.movimientos.set(k, nuevo);
      }
      return { count: filas.length };
    },
    deleteMany: async ({ where }: any) => {
      const claves = [...this.movimientos.entries()]
        .filter(([, f]) => coincideMovimiento(f, where))
        .map(([k]) => k);
      for (const k of claves) this.movimientos.delete(k);
      return { count: claves.length };
    },
    // `update` y `delete` por clave siguen acá aunque el código ya no los use:
    // son los que necesita la versión VIEJA (leer, calcular y escribir) para
    // poder correr cuando se la rompe a propósito y ver el test en rojo.
    update: async ({ where, data }: any) => {
      const k = claveDe(where);
      const actual = this.movimientos.get(k);
      if (actual) this.movimientos.set(k, { ...actual, ...data });
      return this.movimientos.get(k);
    },
    delete: async ({ where }: any) => {
      this.movimientos.delete(claveDe(where));
    },
  };

  /**
   * Solo lo usa `anexarNota`. Imita al `concat_ws` de Postgres: pega la línea
   * al final de la nota del lado de la base, sin releerla.
   */
  async $executeRaw(
    _sql: any,
    linea: string,
    batchId: string,
    recipientCodeId: string,
  ) {
    const f = this.movimientos.get(`${batchId}|${recipientCodeId}`);
    if (!f) return 0;
    f.notes = f.notes ? `${f.notes}\n${linea}` : linea;
    return 1;
  }

  /** Todo o nada, como la de verdad: si el callback lanza, se deshace. */
  async $transaction(fn: (tx: any) => Promise<any>) {
    const foto = {
      comisiones: structuredClone([...this.comisiones.entries()]),
      movimientos: structuredClone([...this.movimientos.entries()]),
      lotes: structuredClone([...this.lotes.entries()]),
    };
    try {
      return await fn(this);
    } catch (e) {
      this.comisiones = new Map(foto.comisiones);
      this.movimientos = new Map(foto.movimientos);
      this.lotes = new Map(foto.lotes);
      throw e;
    }
  }
}

function claveDe(where: any): string {
  const k = where.batchId_recipientCodeId;
  return `${k.batchId}|${k.recipientCodeId}`;
}

/** `where` plano de los movimientos: por corte, por persona y por monto. */
function coincideMovimiento(fila: any, where: any = {}): boolean {
  if (where.batchId !== undefined && fila.batchId !== where.batchId) return false;
  if (
    where.recipientCodeId !== undefined &&
    fila.recipientCodeId !== where.recipientCodeId
  ) {
    return false;
  }
  if (where.amountUsd?.lte !== undefined && !(fila.amountUsd <= where.amountUsd.lte)) {
    return false;
  }
  return true;
}

function comision(id: string, amount: number): Comision {
  return {
    id,
    amount,
    amountPaid: 0,
    status: 'APPROVED',
    paymentStatus: 'PENDING',
    payoutBatchId: 'B',
    recipientCodeId: 'P',
    notes: null,
    paidAt: null,
  };
}

/** Lo que se escribió en el AuditLog durante el test. */
const auditoria: any[] = [];

function servicio(base: BaseFalsa) {
  return new CutoffService(
    base as any,
    {
      log: async (e: any) => {
        auditoria.push(e);
      },
    } as any,
    {} as any,
    { sendInternalAlert: async () => ({ ok: true }) } as any,
  );
}

const S3_ORIGINAL = process.env.S3_PUBLIC_URL;
beforeEach(() => {
  process.env.S3_PUBLIC_URL = BUCKET;
  auditoria.length = 0;
});
afterAll(() => {
  if (S3_ORIGINAL === undefined) delete process.env.S3_PUBLIC_URL;
  else process.env.S3_PUBLIC_URL = S3_ORIGINAL;
});

describe('dos admins pagando la misma selección a la vez', () => {
  it('la segunda se cae y NO deja a la persona con el doble', async () => {
    // El fallo más repetido de esta base: leer, decidir y escribir sin
    // atomicidad. La plata no se duplica (amountPaid = amount es idempotente),
    // pero el movimiento SUMA — y «Comprobantes de pago» mostraría $40 de una
    // transferencia de $20.
    const base = new BaseFalsa([comision('c1', 10), comision('c2', 10)]);
    const svc = servicio(base);
    base.alLeerComisiones = () => base.pagarPorFuera(['c1', 'c2']);

    await expect(
      svc.payBulk(ADMIN, {
        commissionIds: ['c1', 'c2'],
        paymentDate: FECHA,
        proofUrl: COMPROBANTE_A,
        proofMimeType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(base.movimientos.size).toBe(0);
  });

  it('sin carrera, el pago normal deja UN movimiento con el total', async () => {
    const base = new BaseFalsa([comision('c1', 10), comision('c2', 10)]);
    const svc = servicio(base);

    await svc.payBulk(ADMIN, {
      commissionIds: ['c1', 'c2'],
      paymentDate: FECHA,
      proofUrl: COMPROBANTE_A,
      proofMimeType: 'application/pdf',
    });

    expect(base.movimientos.size).toBe(1);
    expect(base.movimiento('B', 'P').amountUsd).toBe(20);
    expect(base.movimiento('B', 'P').proofUrl).toBe(COMPROBANTE_A);
  });
});

describe('revertir un pago y volver a pagarlo', () => {
  it('la reversión se lleva el movimiento y su comprobante', async () => {
    const base = new BaseFalsa([comision('c1', 10), comision('c2', 10)]);
    const svc = servicio(base);

    await svc.payBulk(ADMIN, {
      commissionIds: ['c1', 'c2'],
      paymentDate: FECHA,
      proofUrl: COMPROBANTE_A,
      proofMimeType: 'application/pdf',
    });
    await svc.unpayBulk(ADMIN, {
      commissionIds: ['c1', 'c2'],
      reason: 'la transferencia rebotó',
    });

    expect(base.movimiento('B', 'P')).toBeUndefined();
  });

  it('al repagar sin adjunto NO reaparece el recibo del pago revertido', async () => {
    // Si la reversión no tocara el movimiento, el segundo pago sumaría encima
    // (40 en vez de 20) y el comprobante del pago deshecho se haría pasar por
    // el del nuevo. Un recibo de algo que no pasó.
    const base = new BaseFalsa([comision('c1', 10), comision('c2', 10)]);
    const svc = servicio(base);

    await svc.payBulk(ADMIN, {
      commissionIds: ['c1', 'c2'],
      paymentDate: FECHA,
      proofUrl: COMPROBANTE_A,
      proofMimeType: 'application/pdf',
    });
    await svc.unpayBulk(ADMIN, { commissionIds: ['c1', 'c2'] });
    await svc.payBulk(ADMIN, {
      commissionIds: ['c1', 'c2'],
      paymentDate: FECHA,
    });

    const mov = base.movimiento('B', 'P');
    expect(mov.amountUsd).toBe(20);
    expect(mov.proofUrl ?? null).toBeNull();
  });

  it('una reversión parcial deja lo que sigue pagado, no cero', async () => {
    const base = new BaseFalsa([comision('c1', 10), comision('c2', 10)]);
    const svc = servicio(base);

    await svc.payBulk(ADMIN, {
      commissionIds: ['c1', 'c2'],
      paymentDate: FECHA,
      proofUrl: COMPROBANTE_A,
      proofMimeType: 'application/pdf',
    });
    await svc.unpayBulk(ADMIN, { commissionIds: ['c1'] });

    const mov = base.movimiento('B', 'P');
    expect(mov.amountUsd).toBe(10);
    expect(mov.proofUrl).toBe(COMPROBANTE_A);
    expect(mov.notes ?? '').toContain('Reversión');
  });

  it('la nota avisa de que el comprobante vigente puede ser el que rebotó', async () => {
    // Una fila lleva UNA URL. Si se pagó c1 con A y c2 con B, y se revierte c2,
    // queda vigente B —el giro que no valió— con A enterrado en la nota. No se
    // puede arreglar sin rehacer el modelo, así que al menos se dice.
    const base = new BaseFalsa([comision('c1', 10), comision('c2', 10)]);
    const svc = servicio(base);

    await svc.payBulk(ADMIN, {
      commissionIds: ['c1'],
      paymentDate: FECHA,
      proofUrl: COMPROBANTE_A,
      proofMimeType: 'application/pdf',
    });
    await svc.payBulk(ADMIN, {
      commissionIds: ['c2'],
      paymentDate: FECHA,
      proofUrl: COMPROBANTE_B,
      proofMimeType: 'application/pdf',
    });
    await svc.unpayBulk(ADMIN, { commissionIds: ['c2'], reason: 'rebotó' });

    const mov = base.movimiento('B', 'P');
    expect(mov.amountUsd).toBe(10);
    expect(mov.notes ?? '').toContain('OJO');
  });

  it('lo que se borra queda en el AuditLog: es la última copia de la URL', async () => {
    // `markPersonPaid` no escribe AuditLog, así que si la fila se va sin dejar
    // rastro, el comprobante no existe en ningún otro lado.
    const base = new BaseFalsa([comision('c1', 10), comision('c2', 10)]);
    const svc = servicio(base);

    await svc.payBulk(ADMIN, {
      commissionIds: ['c1', 'c2'],
      paymentDate: FECHA,
      proofUrl: COMPROBANTE_A,
      proofMimeType: 'application/pdf',
    });
    await svc.unpayBulk(ADMIN, {
      commissionIds: ['c1', 'c2'],
      reason: 'rebotó',
    });

    const log = auditoria.find((e) => e.action === 'commission.bulk_unpaid');
    expect(log.metadata.movimientosBorrados).toHaveLength(1);
    expect(log.metadata.movimientosBorrados[0].proofUrl).toBe(COMPROBANTE_A);
    expect(log.metadata.movimientosBorrados[0].amountUsd).toBe(20);
  });

  it('si entra otro pago mientras se revierte, la fila NO se borra', async () => {
    // El borrado lo decide la base (`amountUsd <= 0`), no el número que se leyó
    // antes de restar. Calculándolo a mano, el pago que entró en el medio se
    // perdía junto con la fila.
    const base = new BaseFalsa([comision('c1', 10), comision('c2', 10)]);
    const svc = servicio(base);

    await svc.payBulk(ADMIN, {
      commissionIds: ['c1', 'c2'],
      paymentDate: FECHA,
      proofUrl: COMPROBANTE_A,
      proofMimeType: 'application/pdf',
    });
    // Otro admin le suma $10 a la misma persona justo después de que la
    // reversión leyó los $20.
    base.alLeerMovimiento = () => {
      const m = base.movimiento('B', 'P');
      m.amountUsd = round2(m.amountUsd + 10);
    };
    await svc.unpayBulk(ADMIN, { commissionIds: ['c1', 'c2'] });

    const mov = base.movimiento('B', 'P');
    expect(mov).toBeDefined();
    expect(mov.amountUsd).toBe(10);
  });
});

describe('reabrir un corte cerrado', () => {
  it('reabrir y volver a pagar NO deja el doble con el recibo viejo', async () => {
    // La regresión que abrió el cambio de SET a INCREMENT: `reopenBatch`
    // devolvía las comisiones a APPROVED pero dejaba vivo el movimiento, así
    // que el pago siguiente SUMABA encima. $20 pagados se veían como $40, con
    // el comprobante del primer giro haciéndose pasar por el del segundo.
    const base = new BaseFalsa([comision('c1', 10), comision('c2', 10)]);
    const svc = servicio(base);

    await svc.payBulk(ADMIN, {
      commissionIds: ['c1', 'c2'],
      paymentDate: FECHA,
      proofUrl: COMPROBANTE_A,
      proofMimeType: 'application/pdf',
    });
    // El corte se cierra (lo hace `closeBatch`; acá solo importa el estado).
    base.lotes.get('B').status = 'CLOSED';

    await svc.reopenBatch(ADMIN, 'B', { reason: 'me equivoqué de fecha' });
    expect(base.movimiento('B', 'P')).toBeUndefined();

    await svc.payBulk(ADMIN, {
      commissionIds: ['c1', 'c2'],
      paymentDate: FECHA,
    });

    const mov = base.movimiento('B', 'P');
    expect(mov.amountUsd).toBe(20);
    expect(mov.proofUrl ?? null).toBeNull();
  });

  it('deja en el log el comprobante que se borró con el corte', async () => {
    const base = new BaseFalsa([comision('c1', 10), comision('c2', 10)]);
    const svc = servicio(base);

    await svc.payBulk(ADMIN, {
      commissionIds: ['c1', 'c2'],
      paymentDate: FECHA,
      proofUrl: COMPROBANTE_A,
      proofMimeType: 'application/pdf',
    });
    base.lotes.get('B').status = 'CLOSED';
    await svc.reopenBatch(ADMIN, 'B', { reason: 'fecha mal' });

    const log = auditoria.find((e) => e.action === 'commission.batch_reopened');
    expect(log.metadata.movimientosBorrados[0].proofUrl).toBe(COMPROBANTE_A);
  });
});

describe('pagar el resto desde «Cerrar corte» después de un pago en bloque', () => {
  it('suma al movimiento y no borra el comprobante que ya había', async () => {
    const base = new BaseFalsa([comision('c1', 10), comision('c2', 5)]);
    const svc = servicio(base);

    await svc.payBulk(ADMIN, {
      commissionIds: ['c1'],
      paymentDate: FECHA,
      proofUrl: COMPROBANTE_A,
      proofMimeType: 'application/pdf',
    });
    // El giro del resto se marca desde el modal de cierre, sin adjuntar nada.
    await svc.markPersonPaid(ADMIN, 'B', 'P', {});

    const mov = base.movimiento('B', 'P');
    expect(mov.amountUsd).toBe(15);
    expect(mov.proofUrl).toBe(COMPROBANTE_A);
  });
});

describe('reemplazar el comprobante', () => {
  it('el anterior queda escrito en la nota, no se pierde', async () => {
    const base = new BaseFalsa([comision('c1', 10), comision('c2', 10)]);
    const svc = servicio(base);

    await svc.payBulk(ADMIN, {
      commissionIds: ['c1'],
      paymentDate: FECHA,
      proofUrl: COMPROBANTE_A,
      proofMimeType: 'application/pdf',
    });
    await svc.payBulk(ADMIN, {
      commissionIds: ['c2'],
      paymentDate: FECHA,
      proofUrl: COMPROBANTE_B,
      proofMimeType: 'application/pdf',
    });

    const mov = base.movimiento('B', 'P');
    expect(mov.proofUrl).toBe(COMPROBANTE_B);
    // `?? ''` para que, si la nota se pierde, el fallo diga qué falta en vez de
    // reventar el matcher con un null.
    expect(mov.notes ?? '').toContain('Comprobante anterior');
    expect(mov.notes ?? '').toContain(COMPROBANTE_A);
  });

  it('un comprobante que no es de nuestro bucket no llega a guardarse', async () => {
    const base = new BaseFalsa([comision('c1', 10)]);
    const svc = servicio(base);

    await expect(
      svc.payBulk(ADMIN, {
        commissionIds: ['c1'],
        paymentDate: FECHA,
        proofUrl: 'https://pub-test.r2.dev.attacker.com/x.pdf',
        proofMimeType: 'application/pdf',
      }),
    ).rejects.toThrow();

    expect(base.movimientos.size).toBe(0);
    expect(base.comisiones.get('c1')!.status).toBe('APPROVED');
  });
});
