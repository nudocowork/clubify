import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReporteComisionesService } from './reporte-comisiones.service';

/**
 * El servicio con una base falsa en memoria: lo que se prueba es la REGLA
 * (motivo obligatorio, bitácora con antes/después, cálculo en el servidor, no
 * duplicar), no Prisma.
 */

const ADMIN = { id: 'u-admin', email: 'admin@clubify.test', role: 'SUPER_ADMIN', tenantId: null } as any;
const CLUBIFY = 'wl-clubify';

function base() {
  const db = {
    commissions: new Map<string, any>(),
    auditoria: [] as any[],
    manuales: [] as any[],
    notas: [] as any[],
  };
  const prisma: any = {
    whiteLabel: {
      findFirst: async () => ({ id: CLUBIFY }),
      findUnique: async () => ({ id: CLUBIFY, slug: 'clubify' }),
    },
    commission: {
      findUnique: async ({ where }: any) => {
        const c = db.commissions.get(where.id);
        return c ? { ...c, recipientCode: { id: c.recipientCodeId, whiteLabelId: CLUBIFY }, referralUse: null, payoutBatch: c.payoutBatch ?? null } : null;
      },
      findMany: async () => [],
      updateMany: async () => ({ count: 1 }),
      create: async ({ data }: any) => {
        const id = `com-${db.commissions.size + 1}`;
        const c = { id, createdAt: new Date(), payoutBatchId: null, ...data };
        db.commissions.set(id, c);
        return c;
      },
    },
    commissionAuditLog: {
      findMany: async ({ where }: any) => db.auditoria.filter((a) => a.commissionId === where.commissionId),
      create: async ({ data }: any) => {
        db.auditoria.push({ ...data, createdAt: new Date() });
        return data;
      },
    },
    commissionManual: {
      findUnique: async ({ where }: any) =>
        db.manuales.find((m) => m.claveIdempotencia === where.claveIdempotencia || m.commissionId === where.commissionId) ?? null,
      create: async ({ data }: any) => {
        if (db.manuales.some((m) => m.claveIdempotencia === data.claveIdempotencia)) {
          throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
        }
        db.manuales.push(data);
        return data;
      },
    },
    commissionNote: { create: async ({ data }: any) => (db.notas.push(data), data) },
    referralCode: {
      findFirst: async ({ where }: any) => {
        const id = where.AND?.[0]?.id;
        return id === 'ana' ? { id: 'ana', ownerName: 'Ana' } : null;
      },
    },
    tenant: {
      findFirst: async ({ where }: any) =>
        where.AND?.[0]?.id === 'neg1' ? { id: 'neg1', brandName: 'Café Uno' } : null,
    },
    incomeRecord: {
      findUnique: async ({ where }: any) =>
        where.id === 'ing1'
          ? { id: 'ing1', tenantId: 'neg1', status: 'PAGADO', externalTxId: 'HP123', saleDate: new Date('2026-10-05T15:00:00Z') }
          : null,
    },
    user: { findUnique: async () => ({ fullName: 'Admin' }) },
    $transaction: async (fn: any) => fn(prisma),
  };
  const referrals = {
    enableCommission: vi.fn(async (_u: any, id: string) => {
      db.commissions.get(id).status = 'APPROVED';
      return { ok: true };
    }),
    setCommissionStatus: vi.fn(async (id: string, status: string) => {
      db.commissions.get(id).status = status;
      return { id, status, cascaded: 0 };
    }),
  };
  const cutoff = { markPersonPaid: vi.fn() };
  const svc = new ReporteComisionesService(prisma, referrals as any, cutoff as any, { summary: vi.fn() } as any);
  return { svc, db, prisma, referrals };
}

const comision = (p: Record<string, unknown> = {}) => ({
  id: 'c1',
  status: 'PENDING',
  paymentStatus: 'PENDING',
  amount: new Prisma.Decimal(10),
  amountPaid: new Prisma.Decimal(0),
  payoutBatchId: null,
  recipientCodeId: 'ana',
  notes: null,
  ...p,
});

describe('auditoría obligatoria con motivo', () => {
  let t: ReturnType<typeof base>;
  beforeEach(() => {
    t = base();
    t.db.commissions.set('c1', comision());
  });

  it('sin motivo no se toca nada', async () => {
    await expect(t.svc.aplicarAccion(ADMIN, 'c1', { accion: 'APROBAR', motivo: '  ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(t.referrals.enableCommission).not.toHaveBeenCalled();
    expect(t.db.auditoria).toHaveLength(0);
  });

  it('un motivo de una palabra suelta no basta', async () => {
    await expect(t.svc.aplicarAccion(ADMIN, 'c1', { accion: 'APROBAR', motivo: 'ok' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('aprobar usa el camino de siempre y deja quién, antes, después y motivo', async () => {
    await t.svc.aplicarAccion(ADMIN, 'c1', { accion: 'APROBAR', motivo: 'Cliente confirmó el pago por Nequi' });
    expect(t.referrals.enableCommission).toHaveBeenCalledWith(ADMIN, 'c1', 'Cliente confirmó el pago por Nequi');
    expect(t.db.auditoria).toHaveLength(1);
    const a = t.db.auditoria[0];
    expect(a).toMatchObject({
      accion: 'APROBAR',
      motivo: 'Cliente confirmó el pago por Nequi',
      commissionId: 'c1',
      actorUserId: 'u-admin',
      actorEmail: 'admin@clubify.test',
    });
    expect(a.valorAnterior.status).toBe('PENDING');
    expect(a.valorNuevo.status).toBe('APPROVED');
  });

  it('una comisión con dinero pagado no cambia de estado', async () => {
    t.db.commissions.set('c1', comision({ status: 'APPROVED', paymentStatus: 'PARTIAL', amountPaid: new Prisma.Decimal(4) }));
    await expect(
      t.svc.aplicarAccion(ADMIN, 'c1', { accion: 'REVERSAR', motivo: 'Se cayó la venta, reembolso' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(t.referrals.setCommissionStatus).not.toHaveBeenCalled();
  });

  it('enviar a revisión la deja «En revisión» (retenida + bitácora)', async () => {
    await t.svc.aplicarAccion(ADMIN, 'c1', { accion: 'ENVIAR_A_REVISION', motivo: 'Revisar atribución del vendedor' });
    expect(t.referrals.setCommissionStatus).toHaveBeenCalledWith('c1', 'RETAINED', { cascade: false });
    // Ya está en revisión: repetirlo se rechaza.
    await expect(
      t.svc.aplicarAccion(ADMIN, 'c1', { accion: 'ENVIAR_A_REVISION', motivo: 'Otra vez a revisión' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('+ Nueva comisión', () => {
  const cuerpo = (p: Record<string, unknown> = {}) => ({
    clave: '6f0c2a1e-1111-4222-8333-444455556666',
    fecha: '2026-10-05',
    recipientCodeId: 'ana',
    tenantId: 'neg1',
    tipo: 'BONO' as const,
    baseUsd: 68,
    porcentaje: 12.5,
    descripcion: 'Bono por cierre de Café Uno',
    estadoInicial: 'GENERADA' as const,
    motivo: 'Acordado con Javier en la reunión del lunes',
    ...p,
  });

  it('el monto lo calcula el servidor', async () => {
    const t = base();
    const r: any = await t.svc.crearManual(ADMIN, cuerpo());
    expect(r.montoUsd).toBe(8.5);
    const c = t.db.commissions.get(r.commissionId);
    expect(Number(c.amount)).toBe(8.5);
    // Sin referido: no interfiere con el dedup del webhook ni con el recálculo.
    expect(c.referralUseId).toBeNull();
    expect(c.periodKey).toMatch(/^MANUAL-2026-10-/);
    expect(c.status).toBe('PENDING');
    expect(t.db.auditoria[0]).toMatchObject({ accion: 'CREAR_MANUAL', commissionId: r.commissionId });
  });

  it('monto fijo: ese monto, sin porcentaje', async () => {
    const t = base();
    const r: any = await t.svc.crearManual(ADMIN, cuerpo({ porcentaje: null, montoFijoUsd: 25 }));
    expect(r.montoUsd).toBe(25);
    expect(t.db.manuales[0].montoFijoUsd).toBe(25);
  });

  it('«En revisión» nace retenida y marcada en la bitácora', async () => {
    const t = base();
    const r: any = await t.svc.crearManual(ADMIN, cuerpo({ estadoInicial: 'EN_REVISION' }));
    expect(t.db.commissions.get(r.commissionId).status).toBe('RETAINED');
    expect(t.db.auditoria[0].accion).toBe('CREAR_EN_REVISION');
  });

  it('el doble clic no duplica: la misma clave devuelve la misma comisión', async () => {
    const t = base();
    const a: any = await t.svc.crearManual(ADMIN, cuerpo());
    const b: any = await t.svc.crearManual(ADMIN, cuerpo());
    expect(b).toMatchObject({ commissionId: a.commissionId, duplicada: true });
    expect(t.db.commissions.size).toBe(1);
  });

  it('dos envíos a la vez: el segundo choca con la clave única y recibe el primero', async () => {
    const t = base();
    // Simula la carrera: la consulta previa no ve nada, pero al crear ya existe.
    const original = t.prisma.commissionManual.findUnique;
    let llamadas = 0;
    t.prisma.commissionManual.findUnique = async (args: any) => (llamadas++ === 0 ? null : original(args));
    t.db.manuales.push({ claveIdempotencia: cuerpo().clave, commissionId: 'com-previa' });
    const r: any = await t.svc.crearManual(ADMIN, cuerpo());
    expect(r).toMatchObject({ commissionId: 'com-previa', duplicada: true });
  });

  it('no se crea si el colaborador ya cobra por esa venta', async () => {
    const t = base();
    t.prisma.commission.findMany = async () => [
      {
        status: 'APPROVED',
        hotmartTransactionId: 'HP123',
        externalTxId: 'HP123',
        businessDate: new Date('2026-10-05T17:00:00Z'),
        createdAt: new Date('2026-10-05T17:00:00Z'),
        periodKey: '2026-10',
      },
    ];
    await expect(t.svc.crearManual(ADMIN, cuerpo({ incomeRecordId: 'ing1' }))).rejects.toBeInstanceOf(ConflictException);
    expect(t.db.commissions.size).toBe(0);
  });

  it('sin motivo no se crea', async () => {
    const t = base();
    await expect(t.svc.crearManual(ADMIN, cuerpo({ motivo: '' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(t.db.commissions.size).toBe(0);
  });

  it('un colaborador que no es de la plataforma se rechaza', async () => {
    const t = base();
    await expect(t.svc.crearManual(ADMIN, cuerpo({ recipientCodeId: 'de-sellea' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
