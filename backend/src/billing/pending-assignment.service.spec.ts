import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { PendingAssignmentService } from './pending-assignment.service';

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
    hot: [] as HotRow[],
    tenants: [] as TenantRow[],
    /** data del último tenant.update — lo que el test inspecciona. */
    tenantUpdate: null as Record<string, unknown> | null,
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
      where: { consumedAt: null; OR?: Array<Record<string, unknown>> };
    }) => state.hot.filter((r) => r.consumedAt === null && orMatch(r, where.OR)),
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: { in: string[] }; consumedAt: null };
      data: { consumedAt: Date };
    }) => {
      const rows = state.hot.filter(
        (r) => where.id.in.includes(r.id) && r.consumedAt === null,
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
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  return { state, prisma };
}

const audit = { log: vi.fn(async () => {}) };

function makeService(prisma: unknown) {
  return new PendingAssignmentService(
    prisma as PrismaService,
    audit as unknown as AuditService,
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
      expect(r.currentPeriodEnd.getFullYear()).toBe(esperado.getFullYear());
      expect(r.currentPeriodEnd.getMonth()).toBe(esperado.getMonth());
      expect(r.currentPeriodEnd.getDate()).toBe(esperado.getDate());
      expect(r.lastChargeAt.getTime()).toBe(new Date(2026, 7, 15, 10).getTime());
    },
  );

  it('acota el fin de mes: pago del 31-ene + MENSUAL cae el 28-feb, no el 3-mar', async () => {
    ctx.state.tenants.push(tenant({ planPeriodicity: 'MENSUAL' }));
    ctx.state.hot.push(hotPago({ createdAt: new Date(2026, 0, 31, 9) }));
    const svc = makeService(ctx.prisma);
    const r = await svc.assign({
      gateway: 'HOTMART',
      pendingId: 'p1',
      tenantId: 't1',
      actorId: 'admin-1',
    });
    expect(r.currentPeriodEnd.getMonth()).toBe(1); // febrero
    expect(r.currentPeriodEnd.getDate()).toBe(28);
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
    expect(r.lastChargeAt.getTime()).toBe(new Date(2026, 7, 4).getTime());
    expect(r.currentPeriodEnd.getMonth()).toBe(8); // septiembre
    expect(r.currentPeriodEnd.getDate()).toBe(4);
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
