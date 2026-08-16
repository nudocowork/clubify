import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CutoffService } from '../src/referrals/cutoff.service';

/**
 * Tests de `generateCutoff` con un Prisma FALSO en memoria. Cubren las reglas
 * que no se pueden verificar mirando el calendario: idempotencia, que nadie
 * entre a dos cortes, y que lo que se desbloquea el 16 no caiga en el corte
 * del 15. Sin DB: el matcher de abajo implementa solo los operadores que el
 * service realmente usa.
 */

type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Row[]).some((c) => matches(row, c))) return false;
      continue;
    }
    const v = row[key];
    if (cond === null) {
      if (v !== null && v !== undefined) return false;
    } else if (cond instanceof Date) {
      if (!(v instanceof Date) || v.getTime() !== cond.getTime()) return false;
    } else if (typeof cond === 'object') {
      if ('in' in cond && !(cond.in as any[]).includes(v)) return false;
      if ('not' in cond) {
        if (cond.not === null) {
          if (v === null || v === undefined) return false;
        } else if (v === cond.not) return false;
      }
      if ('lt' in cond) {
        if (v === null || v === undefined) return false;
        if (new Date(v).getTime() >= new Date(cond.lt).getTime()) return false;
      }
      if ('lte' in cond) {
        if (v === null || v === undefined) return false;
        if (new Date(v).getTime() > new Date(cond.lte).getTime()) return false;
      }
      if ('gt' in cond) {
        if (v === null || v === undefined) return false;
        if (new Date(v).getTime() <= new Date(cond.gt).getTime()) return false;
      }
    } else if (v !== cond) return false;
  }
  return true;
}

function makePrisma(commissions: Row[]) {
  const batches: Row[] = [];
  let seq = 0;
  return {
    batches,
    commissions,
    payoutBatch: {
      findUnique: async ({ where }: any) =>
        batches.find((b) => b.code === where.code || b.id === where.id) ?? null,
      findFirst: async ({ where }: any) =>
        batches.find((b) => matches(b, where)) ?? null,
      findMany: async ({ where }: any) =>
        batches.filter((b) => matches(b, where ?? {})),
      findUniqueOrThrow: async ({ where }: any) => {
        const b = batches.find((x) => x.code === where.code || x.id === where.id);
        if (!b) throw new Error('not found');
        return b;
      },
      create: async ({ data }: any) => {
        const row = { id: `b${++seq}`, createdAt: new Date(), ...data };
        batches.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const b = batches.find((x) => x.id === where.id)!;
        Object.assign(b, data);
        return b;
      },
    },
    commission: {
      updateMany: async ({ where, data }: any) => {
        const hit = commissions.filter((c) => matches(c, where));
        for (const c of hit) Object.assign(c, data);
        return { count: hit.length };
      },
      count: async ({ where }: any) =>
        commissions.filter((c) => matches(c, where)).length,
      aggregate: async ({ where }: any) => ({
        _sum: {
          amount: commissions
            .filter((c) => matches(c, where))
            .reduce((s, c) => s + Number(c.amount), 0),
        },
      }),
    },
  };
}

const audit = { log: async () => undefined } as any;
const referrals = { promotePendingToApproved: async () => undefined } as any;

/** Comisión disponible para pagar (hold ya cumplido). */
function approved(id: string, amount: number, availableAt: string): Row {
  return {
    id,
    amount,
    amountPaid: 0,
    status: 'APPROVED',
    paymentStatus: 'PENDING',
    recipientCodeId: 'code1',
    payoutBatchId: null,
    availableAt: new Date(availableAt),
    createdAt: new Date('2026-07-01T12:00:00Z'),
  };
}

describe('generateCutoff', () => {
  let rows: Row[];
  let prisma: ReturnType<typeof makePrisma>;
  let svc: CutoffService;

  beforeEach(() => {
    // Reloj congelado al 17 de agosto: así los desbloqueos del 10/15/16 son
    // PASADO (promovidos de verdad por el cron) y solo cuenta como "habilitada
    // a mano" la que tiene availableAt futuro. Sin esto los tests darían
    // distinto según el día en que se corran.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T12:00:00.000Z'));
    rows = [
      // se desbloqueó el 10 de agosto → entra al corte del 15
      approved('a', 100, '2026-08-10T15:00:00Z'),
      // se desbloqueó el 15 a las 23:00 Bogotá (04:00 UTC del 16) → entra al 15
      approved('b', 50, '2026-08-16T04:00:00Z'),
      // se desbloqueó el 16 a las 00:30 Bogotá → NO entra al corte del 15
      approved('c', 25, '2026-08-16T05:30:00Z'),
      // sigue en hold: ni siquiera está APPROVED
      { ...approved('d', 80, '2026-09-01T12:00:00Z'), status: 'PENDING' },
      // ya pagada
      { ...approved('e', 40, '2026-08-01T12:00:00Z'), paymentStatus: 'PAID', status: 'PAID' },
      // disponible pero sin destinatario: no se le puede transferir a nadie
      { ...approved('f', 10, '2026-08-01T12:00:00Z'), recipientCodeId: null },
    ];
    prisma = makePrisma(rows);
    svc = new CutoffService(prisma as any, audit, referrals);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('crea el corte ABIERTO y adjunta lo disponible, sin marcar nada como pagado', async () => {
    const res = await svc.generateCutoff('2026-08-15');

    expect(res.code).toBe('CORTE-2026-08-15');
    expect(res.created).toBe(true);
    expect(prisma.batches[0].status).toBe('OPEN');
    expect(prisma.batches[0].paymentDate).toBeNull();
    // a + b entran; c (16), d (hold), e (pagada) y f (sin dueño) no.
    expect(res.attached).toBe(2);
    expect(res.totalUsd).toBe(150);
    expect(rows.filter((r) => r.status === 'PAID')).toHaveLength(1); // solo la 'e' previa
    expect(rows.find((r) => r.id === 'e')!.payoutBatchId).toBeNull();
  });

  it('la comisión que se desbloquea el 16 queda para el corte de fin de mes', async () => {
    await svc.generateCutoff('2026-08-15');
    expect(rows.find((r) => r.id === 'c')!.payoutBatchId).toBeNull();

    const fin = await svc.generateCutoff('2026-08-31');
    expect(fin.attached).toBe(1);
    expect(fin.totalUsd).toBe(25);
    expect(rows.find((r) => r.id === 'c')!.payoutBatchId).toBe(fin.batchId);
  });

  it('correrlo dos veces el mismo día no duplica cortes ni comisiones', async () => {
    const first = await svc.generateCutoff('2026-08-15');
    const second = await svc.generateCutoff('2026-08-15');

    expect(prisma.batches).toHaveLength(1);
    expect(second.created).toBe(false);
    expect(second.attached).toBe(0);
    expect(second.batchId).toBe(first.batchId);
    expect(second.totalUsd).toBe(first.totalUsd);
  });

  it('una comisión no puede pertenecer a dos cortes', async () => {
    const c15 = await svc.generateCutoff('2026-08-15');
    const c31 = await svc.generateCutoff('2026-08-31');

    const a = rows.find((r) => r.id === 'a')!;
    expect(a.payoutBatchId).toBe(c15.batchId);
    expect(a.payoutBatchId).not.toBe(c31.batchId);
    // El corte de fin de mes no se llevó nada del anterior.
    expect(c31.totalUsd).toBe(25);
  });

  it('sin nada disponible igual crea el corte en $0 (la serie no se corta)', async () => {
    prisma = makePrisma([]);
    svc = new CutoffService(prisma as any, audit, referrals);
    const res = await svc.generateCutoff('2026-02-28', { auto: true });

    expect(res.created).toBe(true);
    expect(res.attached).toBe(0);
    expect(res.totalUsd).toBe(0);
    expect(prisma.batches[0].code).toBe('CORTE-2026-02-28');
    expect(prisma.batches[0].status).toBe('OPEN');
  });

  it('un corte CERRADO no vuelve a admitir comisiones', async () => {
    const res = await svc.generateCutoff('2026-08-15');
    prisma.batches[0].status = 'CLOSED';

    const again = await svc.generateCutoff('2026-08-15');
    expect(again.attached).toBe(0);
    expect(again.batchId).toBe(res.batchId);
    // La 'c' (liberada el 16) sigue libre para el próximo corte.
    expect(rows.find((r) => r.id === 'c')!.payoutBatchId).toBeNull();
  });

  it('top-up: lo que se desbloquea DURANTE el día entra al corte ya abierto', async () => {
    // El corte del 15 se abre a las 00:00 del 15, cuando 'b' (que se libera a
    // las 22:00 de ese mismo día) todavía está en hold.
    const bRow = rows.find((r) => r.id === 'b')!;
    bRow.status = 'PENDING';
    const res = await svc.generateCutoff('2026-08-15');
    expect(res.attached).toBe(1); // solo 'a'
    expect(res.totalUsd).toBe(100);

    // 22:00 del 15: el cron del hold la promueve. El top-up horario la mete en
    // el corte que le corresponde, sin crear uno nuevo.
    bRow.status = 'APPROVED';
    const added = await (svc as any).topUpOpenBatches();

    expect(added).toBe(1);
    expect(prisma.batches).toHaveLength(1);
    expect(bRow.payoutBatchId).toBe(res.batchId);
    expect(Number(prisma.batches[0].totalUsd)).toBe(150);
    // La del 16 sigue afuera: el top-up respeta la ventana del corte.
    expect(rows.find((r) => r.id === 'c')!.payoutBatchId).toBeNull();
  });

  it('top-up: un corte abierto NO absorbe lo de un día posterior al suyo', async () => {
    const res = await svc.generateCutoff('2026-08-15');
    const before = res.totalUsd;
    // 'c' se liberó el 16 y ya está APPROVED, pero el corte del 15 sigue abierto.
    const added = await (svc as any).topUpOpenBatches();

    expect(added).toBe(0);
    expect(rows.find((r) => r.id === 'c')!.payoutBatchId).toBeNull();
    expect(Number(prisma.batches[0].totalUsd)).toBe(before);
  });

  it('una comisión HABILITADA A MANO entra al corte vigente aunque su hold sea futuro', async () => {
    // "Habilitar" del super admin: pasa a APPROVED pero conserva su availableAt
    // futuro. El sentido de habilitarla es poder pagarla ya.
    const manual = {
      ...approved('g', 33, '2026-12-31T12:00:00Z'),
      status: 'APPROVED',
    };
    rows.push(manual);

    const res = await svc.generateCutoff('2026-08-15');
    expect(manual.payoutBatchId).toBe(res.batchId);
    expect(res.totalUsd).toBe(183); // 100 + 50 + 33
  });

  it('rechaza fechas que no son día de corte', async () => {
    await expect(svc.generateCutoff('2026-08-20')).rejects.toThrow();
    await expect(svc.generateCutoff('2024-02-28')).rejects.toThrow(); // bisiesto: es el 29
  });

  it('el corte guarda la ventana del período', async () => {
    await svc.generateCutoff('2026-08-31');
    const b = prisma.batches[0];
    expect(b.periodStart.toISOString()).toBe('2026-08-16T17:00:00.000Z');
    expect(b.periodEnd.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(b.cutoffDate.toISOString()).toBe('2026-08-31T17:00:00.000Z');
  });
});
