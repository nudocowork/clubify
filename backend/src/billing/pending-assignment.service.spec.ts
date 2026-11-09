import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { PendingAssignmentService, modoDeLaAsignacion } from './pending-assignment.service';

// ── Prisma falso en memoria ─────────────────────────────────────────────────
// Cubre los DOS fallos mudos de «Asignar a negocio» (caso MOTILART):
//   · la fecha del próximo cobro tiene que avanzar por la periodicidad REAL
//     del plan (meses de calendario, fin de mes acotado) — nunca 30 días,
//   · los seis campos de dedup del ciclo tienen que quedar en null — si no,
//     el negocio no recibe NINGÚN aviso del ciclo siguiente y nadie lo nota.

type HotRow = {
  id: string;
  email: string;
  subscriberCode: string | null;
  transactionId: string | null;
  rawPayload: unknown;
  consumedAt: Date | null;
  createdAt: Date;
};

type TenantRow = {
  id: string;
  brandName: string;
  name: string;
  email: string;
  status: string;
  planPeriodicity: string | null;
  currentPeriodEnd: Date | null;
  lastChargeAt: Date | null;
  whiteLabelId: string | null;
  deletedAt: Date | null;
  hotmartSubscriberCode: string | null;
  hotmartTransactionId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  users: { email: string }[];
};

function makeState() {
  const state = {
    /** Importe del ingreso sin dueño que dejó el conciliador; null = no hay. */
    ingresoHuerfano: null as number | null,
    hot: [] as HotRow[],
    tenants: [] as TenantRow[],
    /** data del último tenant.update — lo que el test inspecciona. */
    tenantUpdate: null as Record<string, unknown> | null,
    libro: [] as Record<string, unknown>[],
    libroActualizado: [] as Record<string, unknown>[],
  };
  const orMatch = (r: HotRow, or?: Array<Record<string, unknown>>) =>
    !or ||
    or.some(
      (c) =>
        (c.email === undefined || r.email === c.email) &&
        (c.subscriberCode === undefined ||
          r.subscriberCode === c.subscriberCode),
    );
  const hotDelegate = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      state.hot.find((r) => r.id === where.id) ?? null,
    findMany: async ({
      where,
    }: {
      where: { consumedAt: null; email?: string; OR?: Array<Record<string, unknown>> };
    }) =>
      state.hot.filter(
        (r) =>
          r.consumedAt === null &&
          orMatch(r, where.OR) &&
          (where.email === undefined || r.email === where.email),
      ),
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string | { in: string[] }; consumedAt: null };
      data: { consumedAt: Date };
    }) => {
      const ids = typeof where.id === 'string' ? [where.id] : where.id.in;
      const rows = state.hot.filter(
        (r) => ids.includes(r.id) && r.consumedAt === null,
      );
      rows.forEach((r) => (r.consumedAt = data.consumedAt));
      return { count: rows.length };
    },
  };
  const prisma = {
    pendingHotmartPayment: hotDelegate,
    tenant: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        state.tenants.find((t) => t.id === where.id && !t.deletedAt) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        state.tenantUpdate = data;
        const t = state.tenants.find((x) => x.id === where.id);
        if (!t) throw new Error('tenant not found');
        Object.assign(t, data);
        return t;
      },
    },
    crossTransaction: { updateMany: async () => ({ count: 0 }) },
    // El ingreso que dejó el conciliador sin dueño (ver `enlazarElDinero`).
    incomeRecord: {
      findUnique: async () =>
        state.ingresoHuerfano
          ? { id: 'ir1', tenantId: null, status: 'PAGADO', grossUsd: state.ingresoHuerfano }
          : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.libro.push(data);
        return data;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.libroActualizado.push(data);
        return data;
      },
    },
    whiteLabel: {
      findMany: async () => [{ id: 'wl-sellea', name: 'Sellea', slug: 'sellea' }],
      findFirst: async () => ({ id: 'wl-clubify' }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  return { state, prisma };
}

const audit = { log: vi.fn(async () => {}) };
const income = {
  record: vi.fn(async () => {}),
  desglose: vi.fn(async (_g: string, gross: number) => ({ fee: 0, tax: 0, netExpected: gross })),
  marcarDevuelto: vi.fn(async () => true),
};
const referrals = {
  backfillCommissionForCurrentAssignment: vi.fn(async () => ({ creadas: 1, motivo: null })),
};

function makeService(prisma: unknown) {
  return new PendingAssignmentService(
    prisma as PrismaService,
    audit as unknown as AuditService,
    income as any,
    referrals as any,
  );
}

function tenant(over: Partial<TenantRow> = {}): TenantRow {
  return {
    id: 't1',
    brandName: 'MOTILART',
    name: 'Motilart SAS',
    email: 'contacto@motilart.co',
    status: 'SUSPENDED',
    planPeriodicity: 'MENSUAL',
    currentPeriodEnd: new Date(2026, 5, 4),
    lastChargeAt: new Date(2026, 4, 4),
    whiteLabelId: null,
    deletedAt: null,
    hotmartSubscriberCode: 'WKHH7U1', // el código truncado del caso real
    hotmartTransactionId: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    users: [{ email: 'motilart.bga@gmail.com' }],
    ...over,
  };
}

function hotPago(over: Partial<HotRow> = {}): HotRow {
  const paidAt = over.createdAt ?? new Date(2026, 7, 15, 10);
  return {
    id: 'p1',
    email: 'coysuarez_30@hotmail.com', // paga el contador, no la cuenta
    subscriberCode: 'WKHH7U1I',
    transactionId: 'HP-AGO',
    rawPayload: {
      data: { purchase: { approved_date: paidAt.getTime() } },
    },
    consumedAt: null,
    createdAt: paidAt,
    ...over,
  };
}

describe('PendingAssignmentService.assign — Hotmart', () => {
  let ctx: ReturnType<typeof makeState>;
  beforeEach(() => {
    ctx = makeState();
    audit.log.mockClear();
    // Estos casos son de un pago que cubre HOY: el reloj se fija para que no
    // se vuelvan «historial» cuando pase la fecha del pago.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 7, 20));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. La fecha nueva avanza por la periodicidad del plan ────────────────
  it.each([
    ['MENSUAL', new Date(2026, 8, 15)],
    ['TRIMESTRAL', new Date(2026, 10, 15)],
    ['SEMESTRAL', new Date(2027, 1, 15)],
    ['ANUAL', new Date(2027, 7, 15)],
    // null se trata como MENSUAL (convención global de plan-period).
    [null, new Date(2026, 8, 15)],
  ])(
    'periodicidad %s → currentPeriodEnd = fecha del pago + ciclo completo',
    async (per, esperado) => {
      ctx.state.tenants.push(tenant({ planPeriodicity: per as string | null }));
      ctx.state.hot.push(hotPago({ createdAt: new Date(2026, 7, 15, 10) }));
      const svc = makeService(ctx.prisma);
      const r = await svc.assign({
        gateway: 'HOTMART',
        pendingId: 'p1',
        tenantId: 't1',
        actorId: 'admin-1',
      });
      expect(r.currentPeriodEnd!.getFullYear()).toBe(esperado.getFullYear());
      expect(r.currentPeriodEnd!.getMonth()).toBe(esperado.getMonth());
      expect(r.currentPeriodEnd!.getDate()).toBe(esperado.getDate());
      expect(r.lastChargeAt!.getTime()).toBe(new Date(2026, 7, 15, 10).getTime());
    },
  );

  it('acota el fin de mes: pago del 31-ene + MENSUAL cae el 28-feb, no el 3-mar', async () => {
    vi.setSystemTime(new Date(2026, 1, 1));
    ctx.state.tenants.push(tenant({ planPeriodicity: 'MENSUAL', currentPeriodEnd: new Date(2026, 0, 1) }));
    ctx.state.hot.push(hotPago({ createdAt: new Date(2026, 0, 31, 9) }));
    const svc = makeService(ctx.prisma);
    const r = await svc.assign({
      gateway: 'HOTMART',
      pendingId: 'p1',
      tenantId: 't1',
      actorId: 'admin-1',
    });
    expect(r.currentPeriodEnd!.getMonth()).toBe(1); // febrero
    expect(r.currentPeriodEnd!.getDate()).toBe(28);
  });

  // ── 2. Los seis campos de dedup del ciclo quedan limpios ─────────────────
  it('limpia los 6 campos de dedup — sin esto el negocio no recibe ningún aviso del ciclo siguiente', async () => {
    ctx.state.tenants.push(
      tenant({
        // Simular que el ciclo viejo ya envió TODOS sus avisos.
        planPeriodicity: 'MENSUAL',
      }),
    );
    ctx.state.hot.push(hotPago());
    const svc = makeService(ctx.prisma);
    await svc.assign({
      gateway: 'HOTMART',
      pendingId: 'p1',
      tenantId: 't1',
      actorId: 'admin-1',
    });
    const data = ctx.state.tenantUpdate!;
    for (const campo of [
      'preReminder7dSentFor',
      'preReminder3dSentFor',
      'preReminderTodaySentFor',
      'paymentReminderSentFor',
      'paymentFailureNoticeSentAt',
      'pausePendingNoticeSentAt',
    ]) {
      // toBeNull (y no undefined): undefined haría que Prisma NO tocara el
      // campo y el aviso viejo seguiría bloqueando el ciclo nuevo.
      expect(data[campo], campo).toBeNull();
    }
    expect(data.failedPaymentCount).toBe(0);
    expect(data.status).toBe('ACTIVE');
  });

  it('enlaza el código COMPLETO y la transacción para que el próximo cobro sea RENOVACIÓN', async () => {
    ctx.state.tenants.push(tenant());
    ctx.state.hot.push(hotPago());
    const svc = makeService(ctx.prisma);
    await svc.assign({
      gateway: 'HOTMART',
      pendingId: 'p1',
      tenantId: 't1',
      actorId: 'admin-1',
    });
    const t = ctx.state.tenants[0];
    expect(t.hotmartSubscriberCode).toBe('WKHH7U1I'); // ya no el truncado
    expect(t.hotmartTransactionId).toBe('HP-AGO');
  });

  // ── 3. Varios pagos del mismo suscriptor (los 3 meses de MOTILART) ───────
  it('consume TODOS los pendientes del comprador y el ciclo sale del pago más reciente', async () => {
    ctx.state.tenants.push(tenant({ planPeriodicity: 'MENSUAL' }));
    ctx.state.hot.push(
      hotPago({ id: 'jun', transactionId: 'HP-JUN', createdAt: new Date(2026, 5, 4) }),
      hotPago({ id: 'jul', transactionId: 'HP-JUL', createdAt: new Date(2026, 6, 4) }),
      hotPago({ id: 'ago', transactionId: 'HP-AGO', createdAt: new Date(2026, 7, 4) }),
    );
    const svc = makeService(ctx.prisma);
    // El admin asigna la fila de JUNIO (la primera que ve): igual el ciclo
    // debe salir del pago de AGOSTO, no dejar al negocio "vencido" en julio.
    const r = await svc.assign({
      gateway: 'HOTMART',
      pendingId: 'jun',
      tenantId: 't1',
      actorId: 'admin-1',
    });
    expect(r.consumedPendingIds.sort()).toEqual(['ago', 'jul', 'jun'].sort());
    expect(ctx.state.hot.every((p) => p.consumedAt !== null)).toBe(true);
    expect(r.lastChargeAt!.getTime()).toBe(new Date(2026, 7, 4).getTime());
    expect(r.currentPeriodEnd!.getMonth()).toBe(8); // septiembre
    expect(r.currentPeriodEnd!.getDate()).toBe(4);
    expect(ctx.state.tenants[0].hotmartTransactionId).toBe('HP-AGO');
  });

  // ── Guardas ──────────────────────────────────────────────────────────────
  it('rechaza un pago ya consumido', async () => {
    ctx.state.tenants.push(tenant());
    ctx.state.hot.push(hotPago({ consumedAt: new Date() }));
    const svc = makeService(ctx.prisma);
    await expect(
      svc.assign({ gateway: 'HOTMART', pendingId: 'p1', tenantId: 't1', actorId: 'a' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un negocio inexistente o borrado', async () => {
    ctx.state.tenants.push(tenant({ deletedAt: new Date() }));
    ctx.state.hot.push(hotPago());
    const svc = makeService(ctx.prisma);
    await expect(
      svc.assign({ gateway: 'HOTMART', pendingId: 'p1', tenantId: 't1', actorId: 'a' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('audita quién asignó qué a quién', async () => {
    ctx.state.tenants.push(tenant());
    ctx.state.hot.push(hotPago());
    const svc = makeService(ctx.prisma);
    await svc.assign({
      gateway: 'HOTMART',
      pendingId: 'p1',
      tenantId: 't1',
      actorId: 'admin-7',
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-7',
        tenantId: 't1',
        action: 'pending_payment.assigned_to_tenant',
      }),
    );
  });
});

describe('PendingAssignmentService.preview', () => {
  it('muestra el contraste de correos y NO escribe nada', async () => {
    const ctx = makeState();
    ctx.state.tenants.push(tenant());
    ctx.state.hot.push(hotPago());
    const svc = makeService(ctx.prisma);
    const p = await svc.preview('HOTMART', 'p1', 't1');
    expect(p.paymentEmail).toBe('coysuarez_30@hotmail.com');
    expect(p.tenant.email).toBe('motilart.bga@gmail.com');
    expect(p.emailsDiffer).toBe(true);
    expect(p.paymentsToApply).toBe(1);
    // La vista previa no debe tocar ni el tenant ni los pendientes.
    expect(ctx.state.tenantUpdate).toBeNull();
    expect(ctx.state.hot[0].consumedAt).toBeNull();
  });
});

// ── Pagos viejos: se registran, no activan (Javier, 2026-11-09) ─────────────
describe('PendingAssignmentService.assign — pago de un ciclo pasado', () => {
  let ctx: ReturnType<typeof makeState>;
  beforeEach(() => {
    ctx = makeState();
    referrals.backfillCommissionForCurrentAssignment.mockClear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 9));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('DINOROLLS: el pago de su primera suscripción NO reactiva a un negocio que no renovó', async () => {
    ctx.state.tenants.push(
      tenant({ brandName: 'DINOROLLS', status: 'SUSPENDED', currentPeriodEnd: new Date(2026, 9, 15) }),
    );
    ctx.state.hot.push(hotPago({ createdAt: new Date(2026, 6, 15) }));
    const svc = makeService(ctx.prisma);
    const p = await svc.preview('HOTMART', 'p1', 't1');
    expect(p.modo).toBe('HISTORICO');
    expect(p.motivo).toBe('ya_cubierto_por_renovacion');
    const r = await svc.assign({ gateway: 'HOTMART', pendingId: 'p1', tenantId: 't1', actorId: 'a' });
    expect(r.modo).toBe('HISTORICO');
    expect(ctx.state.tenantUpdate).toBeNull();
    expect(ctx.state.tenants[0].status).toBe('SUSPENDED');
    expect(r.statusAfter).toBe('SUSPENDED');
    // Sale de la lista igual.
    expect(ctx.state.hot[0].consumedAt).not.toBeNull();
    // Ni comisión del ciclo actual por un pago de julio.
    expect(referrals.backfillCommissionForCurrentAssignment).not.toHaveBeenCalled();
  });

  it('un pago cuyo ciclo ya terminó, aunque el negocio esté aún más atrás, no activa', async () => {
    ctx.state.tenants.push(tenant({ status: 'SUSPENDED', currentPeriodEnd: new Date(2026, 5, 4) }));
    ctx.state.hot.push(hotPago({ createdAt: new Date(2026, 7, 15) })); // cubría hasta el 15-sep
    const svc = makeService(ctx.prisma);
    const r = await svc.assign({ gateway: 'HOTMART', pendingId: 'p1', tenantId: 't1', actorId: 'a' });
    expect(r.modo).toBe('HISTORICO');
    expect(r.motivo).toBe('ciclo_vencido');
    expect(ctx.state.tenants[0].status).toBe('SUSPENDED');
  });

  it('RICURAS: el primer pago con otro correo no pisa el correo/código ni la fecha de las renovaciones', async () => {
    ctx.state.tenants.push(
      tenant({
        brandName: 'Restaurante Ricuras',
        status: 'ACTIVE',
        planPeriodicity: 'TRIMESTRAL',
        currentPeriodEnd: new Date(2027, 0, 16),
        hotmartSubscriberCode: 'COD-NUEVO',
        hotmartTransactionId: 'HP-RENOV',
      }),
    );
    ctx.state.hot.push(
      hotPago({ email: 'dmoreno758@unab.edu.co', subscriberCode: 'COD-VIEJO', createdAt: new Date(2026, 6, 16) }),
    );
    const svc = makeService(ctx.prisma);
    const r = await svc.assign({ gateway: 'HOTMART', pendingId: 'p1', tenantId: 't1', actorId: 'a' });
    expect(r.modo).toBe('HISTORICO');
    const t = ctx.state.tenants[0];
    expect(t.status).toBe('ACTIVE');
    expect(t.hotmartSubscriberCode).toBe('COD-NUEVO');
    expect(t.hotmartTransactionId).toBe('HP-RENOV');
    expect(t.currentPeriodEnd!.getTime()).toBe(new Date(2027, 0, 16).getTime());
  });

  it('LA PRUEBA SABE PONERSE EN ROJO: un pago que cubre hoy sí activa', async () => {
    ctx.state.tenants.push(tenant({ status: 'SUSPENDED', currentPeriodEnd: new Date(2026, 9, 1) }));
    ctx.state.hot.push(hotPago({ createdAt: new Date(2026, 10, 5) }));
    const svc = makeService(ctx.prisma);
    const r = await svc.assign({ gateway: 'HOTMART', pendingId: 'p1', tenantId: 't1', actorId: 'a' });
    expect(r.modo).toBe('ACTIVA');
    expect(ctx.state.tenants[0].status).toBe('ACTIVE');
  });
});

describe('modoDeLaAsignacion', () => {
  const ahora = new Date(2026, 10, 9);
  it.each([
    ['cubre hoy y más que el negocio', new Date(2026, 11, 1), new Date(2026, 10, 1), 'ACTIVA'],
    ['cubre hoy, negocio sin fecha', new Date(2026, 11, 1), null, 'ACTIVA'],
    ['ciclo terminado', new Date(2026, 9, 1), null, 'HISTORICO'],
    ['negocio ya cubierto igual', new Date(2026, 11, 1), new Date(2026, 11, 1), 'HISTORICO'],
    ['negocio ya cubierto más allá', new Date(2026, 11, 1), new Date(2027, 0, 1), 'HISTORICO'],
  ])('%s', (_n, pago, negocio, esperado) => {
    expect(
      modoDeLaAsignacion({ pagoCubreHasta: pago as Date, negocioCubiertoHasta: negocio as Date | null, ahora }).modo,
    ).toBe(esperado);
  });
});

describe('PendingAssignmentService.assignToBrand', () => {
  it('HUMBERTO: los pagos de un admin de Sellea van a la marca, intermediados, sin tocar negocios', async () => {
    const ctx = makeState();
    const pago = (id: string, mes: number) =>
      hotPago({
        id,
        email: 'info@medicenache.com',
        transactionId: `HP-${id}`,
        rawPayload: {
          data: {
            purchase: {
              approved_date: new Date(2026, mes, 5).getTime(),
              price: { value: 99.03, currency_value: 'USD' },
            },
            subscription: { plan: { name: 'Automatización de WhatsApp' } },
          },
        },
      });
    ctx.state.hot.push(pago('jul', 6), pago('ago', 7));
    const svc = makeService(ctx.prisma);
    const r = await svc.assignToBrand({ pendingId: 'jul', whiteLabelId: 'wl-sellea', concepto: 'SERVICIO', actorId: 'a' });
    expect(r.pagos).toBe(2);
    expect(r.enLibro).toBe(2);
    expect(ctx.state.hot.every((h) => h.consumedAt !== null)).toBe(true);
    expect(ctx.state.tenantUpdate).toBeNull();
    for (const fila of ctx.state.libro) {
      expect(fila.payerWhiteLabelId).toBe('wl-sellea');
      expect(fila.tenantId).toBeNull();
      expect(fila.status).toBe('INTERMEDIADO');
      expect(fila.productName).toBe('Servicio: Automatización de WhatsApp');
    }
  });

  it('rechaza una marca que no existe', async () => {
    const ctx = makeState();
    ctx.state.hot.push(hotPago());
    const svc = makeService(ctx.prisma);
    await expect(
      svc.assignToBrand({ pendingId: 'p1', whiteLabelId: 'otra', concepto: 'OTRO', actorId: 'a' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.state.hot[0].consumedAt).toBeNull();
  });
});

describe('PendingAssignmentService.discard', () => {
  it('ANGELICA: un pago reembolsado sale de la lista, deja de contar y queda auditado', async () => {
    const ctx = makeState();
    ctx.state.hot.push(hotPago({ transactionId: 'HP-DEVUELTO' }));
    income.marcarDevuelto.mockClear();
    const svc = makeService(ctx.prisma);
    await svc.discard({ gateway: 'HOTMART', pendingId: 'p1', motivo: 'REEMBOLSO', actorId: 'a' });
    expect(ctx.state.hot[0].consumedAt).not.toBeNull();
    expect(income.marcarDevuelto).toHaveBeenCalledWith('HOTMART', 'HP-DEVUELTO', 'REEMBOLSADO', expect.any(Date));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'pending_payment.discarded' }));
  });
});
