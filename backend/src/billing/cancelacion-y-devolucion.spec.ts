import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BillingService } from './billing.service';
import { estadoComercial } from '../common/estado-comercial';
import { notaDelEstado } from './estado-del-negocio';

/**
 * Cancelación, suspensión y devoluciones, de punta a punta en `BillingService`
 * (Javier, 2026-11-23). La base es falsa; lo que se prueba es la lógica: qué
 * queda escrito en el negocio, qué SMS sale y cuántas veces.
 */

const AHORA = new Date('2026-11-23T20:00:00.000Z');

function negocioBase(extra: Record<string, unknown> = {}) {
  return {
    id: 't-protein',
    brandName: 'Protein Station',
    status: 'ACTIVE',
    trialEndsAt: null,
    // Trimestre pagado hasta el 23 de enero.
    currentPeriodEnd: new Date('2027-01-23T12:00:00.000Z'),
    lastChargeAt: new Date('2026-10-23T13:28:48.000Z'),
    failedPaymentCount: 0,
    canceledAt: null,
    cancelSource: null,
    cancelReason: null,
    suspendReason: null,
    suspendedAt: null,
    cancelNoticeSentAt: null,
    cancelNoticeTemplate: null,
    hotmartSubscriberCode: 'BRW813M3',
    stripeSubscriptionId: null,
    ...extra,
  } as Record<string, any>;
}

function montar(opts: { negocio?: Record<string, any>; smsOk?: boolean; sinDestino?: boolean; hotmartApi?: any } = {}) {
  const t = opts.negocio ?? negocioBase();
  const auditado: any[] = [];
  const sms: Array<{ phone: string; body: string; ctx: any }> = [];
  const plantillas: string[] = [];
  const prisma: any = {
    tenant: {
      findUnique: async () => ({ ...t }),
      findFirst: async () => ({ ...t }),
      update: async ({ data }: any) => {
        Object.assign(t, data);
        return { ...t };
      },
      updateMany: async ({ where, data }: any) => {
        // El reclamo del aviso compara lo que había.
        for (const k of ['cancelNoticeSentAt', 'cancelNoticeTemplate'] as const) {
          if (k in where && (where[k] ?? null) !== (t[k] ?? null)) return { count: 0 };
        }
        Object.assign(t, data);
        return { count: 1 };
      },
    },
    user: { findFirst: async () => ({ fullName: 'Martha Gonzalez' }) },
    setting: { findUnique: async () => null },
    whiteLabel: { findFirst: async () => ({ id: 'wl-clubify' }), findUnique: async () => null },
    incomeRecord: {
      findFirst: async ({ where }: any) =>
        where.externalTxId
          ? { id: 'ing-oct', gateway: 'HOTMART', saleDate: new Date('2026-10-23T13:28:48.000Z'), status: 'PAGADO', grossUsd: 150 }
          : { id: 'ing-oct' },
      findMany: async () => [],
      count: async () => 0,
    },
    commission: {
      findMany: async () => [],
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
      create: async () => null,
    },
    payoutBatch: { findMany: async () => [] },
  };
  const audit: any = { log: (x: unknown) => auditado.push(x) };
  const growBusiness: any = {
    sendSmsWithCreds: async (_c: unknown, phone: string, body: string, ctx: unknown) => {
      sms.push({ phone, body, ctx });
      return opts.smsOk === false ? { ok: false, message: 'GHL 500' } : { ok: true };
    },
  };
  const smsTemplates: any = {
    render: async (id: string, vars: Record<string, string>) => {
      plantillas.push(id);
      return `[${id}] ${vars.ownerName} · ${vars.brandName} · ${vars.pasarela}`;
    },
  };
  const prereg: any = { sendInternalAlert: async () => ({ ok: true }) };
  const income: any = { marcarDevuelto: vi.fn(async () => true) };
  const svc = new BillingService(
    prisma,
    growBusiness,
    smsTemplates,
    {} as any,
    audit,
    prereg,
    opts.hotmartApi ?? ({ estaConfigurada: () => false } as any),
    income,
  );
  vi.spyOn(svc, 'resolveBillingTarget').mockImplementation(async () =>
    opts.sinDestino ? null : { creds: { locationId: 'loc', apiKey: 'k', switchNumber: null }, phone: '+573163055449' },
  );
  vi.spyOn(svc, 'releaseBrandCreditOnSuspend').mockImplementation(async () => false);
  return { svc, t, auditado, sms, plantillas, income };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('1 · el cliente pulsa «Cancelar mi suscripción»', () => {
  it('queda CANCELADO por el cliente, conserva lo pagado y recibe el SMS al teléfono del negocio', async () => {
    const { svc, t, sms, auditado } = montar();
    const r = await svc.cancelSubscription('t-protein', 'cierro el local');
    expect(t.canceledAt).toBeInstanceOf(Date);
    expect(t.cancelSource).toBe('CLIENTE_PANEL');
    expect(t.cancelReason).toBe('cierro el local');
    expect(t.status).toBe('ACTIVE'); // le quedan dos meses pagados
    expect(estadoComercial(t as any)).toBe('CANCELADO');
    expect(sms).toHaveLength(1);
    expect(sms[0].phone).toBe('+573163055449');
    expect(sms[0].body).toContain('[cancel_aviso_panel] Martha · Protein Station · Hotmart');
    // Queda en el historial de mensajes del negocio, con su plantilla.
    expect(sms[0].ctx).toMatchObject({ tenantId: 't-protein', templateId: 'cancel_aviso_panel', feature: 'billing' });
    // Y la constancia del envío, con su resultado.
    expect(auditado).toContainEqual(
      expect.objectContaining({ action: 'billing.aviso_cancelacion', metadata: expect.objectContaining({ resultado: 'enviado' }) }),
    );
    expect(r.avisoEnviado).toBe(true);
  });

  it('pulsarlo otra vez NO manda un segundo SMS', async () => {
    const { svc, sms } = montar();
    await svc.cancelSubscription('t-protein');
    await svc.cancelSubscription('t-protein');
    await svc.cancelSubscription('t-protein');
    expect(sms).toHaveLength(1);
  });

  it('si el SMS falla, queda registrado como fallido y un intento posterior puede volver a avisar', async () => {
    const { svc, t, auditado } = montar({ smsOk: false });
    await svc.cancelSubscription('t-protein');
    expect(auditado).toContainEqual(
      expect.objectContaining({
        action: 'billing.aviso_cancelacion',
        metadata: expect.objectContaining({ resultado: 'fallido', detalle: 'GHL 500' }),
      }),
    );
    // El reclamo se devolvió: no figura como avisado.
    expect(t.cancelNoticeSentAt).toBeNull();
  });

  it('sin teléfono ni canal, se registra «sin destino» en vez de fallar en silencio', async () => {
    const { svc, auditado } = montar({ sinDestino: true });
    await svc.cancelSubscription('t-protein');
    expect(auditado).toContainEqual(
      expect.objectContaining({ metadata: expect.objectContaining({ resultado: 'sin_destino' }) }),
    );
  });
});

describe('3 · un colaborador cancela', () => {
  it('queda CANCELADO por un colaborador, con su motivo, y se cancela también en Hotmart', async () => {
    const llamadas: string[] = [];
    const hotmartApi = {
      estaConfigurada: () => true,
      cancelarSuscripcion: async (code: string) => {
        llamadas.push(code);
        return { ok: true, status: 'CANCELLED' };
      },
    };
    const { svc, t, sms, auditado } = montar({ hotmartApi });
    const r = await svc.cancelarPorColaborador('t-protein', 'user-sara', { motivo: 'lo pidió por WhatsApp' });
    expect(t.cancelSource).toBe('COLABORADOR');
    expect(t.cancelReason).toBe('lo pidió por WhatsApp');
    expect(estadoComercial(t as any)).toBe('CANCELADO');
    expect(llamadas).toEqual(['BRW813M3']);
    expect(r.pasarela).toEqual({ intentada: true, ok: true });
    expect(sms[0].ctx.templateId).toBe('cancel_aviso_colaborador');
    expect(auditado).toContainEqual(
      expect.objectContaining({ action: 'billing.cancelacion', actorId: 'user-sara' }),
    );
  });

  it('sin motivo no se cancela', async () => {
    const { svc } = montar();
    await expect(svc.cancelarPorColaborador('t-protein', 'u', { motivo: '  ' })).rejects.toThrow(/motivo/);
  });

  it('«desconectar ya» corta el servicio aunque le queden días pagados', async () => {
    const { svc, t } = montar();
    await svc.cancelarPorColaborador('t-protein', 'u', { motivo: 'fraude', desconectarYa: true });
    expect(t.status).toBe('SUSPENDED');
  });
});

describe('7 · contracargo / reembolso del cobro actual', () => {
  it('el cobro deja de contar, el negocio queda CANCELADO y desconectado, y recibe SU aviso', async () => {
    const { svc, t, sms, income } = montar({
      // Ya había cancelado el 21 en Hotmart: es el caso de Protein Station.
      negocio: negocioBase({
        canceledAt: new Date('2026-11-21T21:59:06.692Z'),
        cancelSource: 'CLIENTE_PASARELA',
      }),
    });
    const r = await svc.aplicarDevolucion({
      tenantId: 't-protein',
      tx: 'HP0032012122',
      tipo: 'CONTRACARGO',
      gateway: 'HOTMART',
    });
    expect(income.marcarDevuelto).toHaveBeenCalledWith('HOTMART', 'HP0032012122', 'REEMBOLSADO', expect.any(Date));
    expect(r.ingresoMarcado).toBe(true);
    expect(t.status).toBe('SUSPENDED');
    expect(t.suspendReason).toBe('DEVOLUCION');
    // El contracargo pisa la cancelación anterior; la primera fecha se conserva.
    expect(t.cancelSource).toBe('CONTRACARGO');
    expect(t.canceledAt.toISOString()).toBe('2026-11-21T21:59:06.692Z');
    expect(notaDelEstado(t as any, AHORA)).toMatch(/^Cancelado por contracargo del pago \(tx HP0032012122\).*Servicio desconectado\.$/);
    expect(sms.map((s) => s.ctx.templateId)).toEqual(['cancel_aviso_contracargo']);
  });

  it('una disputa deja el cobro EN_DISPUTA (no suma), no REEMBOLSADO', async () => {
    const { svc, income } = montar();
    await svc.aplicarDevolucion({ tenantId: 't-protein', tx: 'HP1', tipo: 'DISPUTA', gateway: 'HOTMART' });
    expect(income.marcarDevuelto).toHaveBeenCalledWith('HOTMART', 'HP1', 'EN_DISPUTA', expect.any(Date));
  });

  it('el mismo aviso dos veces: un solo SMS', async () => {
    const { svc, sms } = montar();
    const args = { tenantId: 't-protein', tx: 'HP1', tipo: 'REEMBOLSO' as const, gateway: 'HOTMART' as const };
    await svc.aplicarDevolucion(args);
    await svc.aplicarDevolucion(args);
    expect(sms).toHaveLength(1);
  });

  it('la devolución de un cobro VIEJO no le quita el período que pagó después', async () => {
    const { svc, t, sms } = montar();
    await svc.aplicarDevolucion({
      tenantId: 't-protein',
      tx: 'HP-JULIO',
      tipo: 'REEMBOLSO',
      gateway: 'HOTMART',
      esDelPeriodoActual: false,
    });
    expect(t.status).toBe('ACTIVE');
    expect(t.canceledAt).toBeNull();
    expect(sms).toHaveLength(0);
  });

  it('un colaborador registra la devolución: misma lógica, y queda quién lo hizo', async () => {
    const { svc, t, auditado } = montar();
    const r = await svc.devolucionPorColaborador('t-protein', 'user-javier', {
      externalTxId: 'HP0032012122',
      tipo: 'REEMBOLSO',
      nota: 'reembolsado a mano en Hotmart',
    });
    expect(r.esDelPeriodoActual).toBe(true);
    expect(t.cancelSource).toBe('REEMBOLSO');
    expect(auditado).toContainEqual(
      expect.objectContaining({
        action: 'billing.devolucion',
        actorId: 'user-javier',
        metadata: expect.objectContaining({ registradaPor: 'colaborador', tipo: 'REEMBOLSO' }),
      }),
    );
  });
});
