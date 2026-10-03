import { describe, it, expect, beforeAll, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import {
  fechaDelPago,
  firmaValida,
  partirToken,
  tokenDelCloser,
  usdSugerido,
  validarFormulario,
} from './registro-de-pago';
import { PagosPorAprobarService } from './pagos-por-aprobar.service';

/**
 * Pagos por fuera que registra un closer y aprueba un admin (Sara, 2026-10-03):
 * el afiliado sale del ENLACE —no se puede olvidar— y nada se activa, ni se
 * comisiona, ni se apunta en Contabilidad hasta que alguien pulse «Aprobar».
 */

beforeAll(() => {
  process.env.JWT_SECRET = 'secreto-de-prueba';
});

const AHORA = new Date('2026-10-03T15:00:00Z');
const BUENO = {
  brandName: '  Café   del Centro ',
  ownerEmail: 'Ana@Ejemplo.com',
  ownerPhone: '+57 300 123 4567',
  ownerFullName: 'Ana Pérez',
  planPeriodicity: 'trimestral',
  method: 'nequi',
  amount: '150',
  currency: 'USD',
  paidAt: '2026-10-02',
  reference: 'M123',
};

describe('el enlace de cada closer', () => {
  it('lleva el código y una firma que solo vale para ESE código', () => {
    const t = tokenDelCloser({ id: 'id-sara', code: 'MJUBQ8H8' });
    const p = partirToken(t)!;
    expect(p.code).toBe('MJUBQ8H8');
    expect(firmaValida('id-sara', p.sig)).toBe(true);
    // Cambiar el código del enlace por el de otro closer no sirve.
    expect(firmaValida('id-de-otro', p.sig)).toBe(false);
  });

  it('un código con guiones se separa bien de su firma', () => {
    const t = tokenDelCloser({ id: 'x', code: 'NICO-2026' });
    expect(partirToken(t)?.code).toBe('NICO-2026');
  });

  it('enlaces mal formados no pasan', () => {
    expect(partirToken('sinfirma')).toBeNull();
    expect(partirToken('CODIGO-')).toBeNull();
    expect(firmaValida('x', 'corta')).toBe(false);
  });
});

describe('el formulario del closer', () => {
  it('limpia lo que llega: espacios, correo en minúsculas, teléfono con dígitos', () => {
    const r = validarFormulario(BUENO, AHORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos).toMatchObject({
      brandName: 'Café del Centro',
      ownerEmail: 'ana@ejemplo.com',
      ownerPhone: '+573001234567',
      planPeriodicity: 'TRIMESTRAL',
      method: 'NEQUI',
      amount: 150,
    });
  });

  it('dice qué falta, campo por campo', () => {
    const r = validarFormulario({}, AHORA);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errores).sort()).toEqual(
      ['amount', 'brandName', 'method', 'ownerEmail', 'ownerFullName', 'paidAt', 'planPeriodicity'].sort(),
    );
  });

  it('el monto con puntos de miles se rechaza en vez de leerse mal', () => {
    // «1.500.000» se leería como 1,5: mejor pedirlo sin puntos.
    const r = validarFormulario({ ...BUENO, amount: '1.500.000', currency: 'COP' }, AHORA);
    expect(r.ok).toBe(false);
    expect(validarFormulario({ ...BUENO, amount: '150,5' }, AHORA).ok).toBe(true);
  });

  it('un pago con fecha futura no existe todavía', () => {
    const r = validarFormulario({ ...BUENO, paidAt: '2026-10-10' }, AHORA);
    expect(r.ok).toBe(false);
  });

  it('la fecha del pago es el día en Colombia, no se corre al anterior', () => {
    const d = fechaDelPago('2026-10-02')!;
    // Mediodía de Bogotá: en cualquier zona de América sigue siendo el 2.
    expect(d.toISOString()).toBe('2026-10-02T17:00:00.000Z');
  });

  it('a Contabilidad entra el monto si es en USD, y el precio del plan si no', () => {
    expect(usdSugerido(150, 'USD', 150)).toBe(150);
    expect(usdSugerido(600000, 'COP', 150)).toBe(150);
  });
});

// ── La aprobación ───────────────────────────────────────────────────────────

function montar(estadoInicial = 'PENDIENTE') {
  const solicitud: any = {
    id: 'sol-1',
    referralCodeId: 'code-nico',
    closerName: 'Nicolás',
    whiteLabelId: null,
    status: estadoInicial,
    brandName: 'Café del Centro',
    ownerEmail: 'ana@ejemplo.com',
    ownerPhone: '+573001234567',
    ownerFullName: 'Ana Pérez',
    planPeriodicity: 'TRIMESTRAL',
    businessType: 'FULL',
    businessCategorySlug: 'restaurante',
    method: 'NEQUI',
    amount: 600000,
    currency: 'COP',
    paidAt: new Date('2026-10-02T17:00:00Z'),
    reference: 'M123',
    proofUrl: 'https://bucket/comprobantes/x.jpg',
    note: null,
    amountUsd: null,
    createdTenantId: null,
  };
  const prisma: any = {
    whiteLabel: { findFirst: async () => ({ id: 'wl-clubify' }) },
    setting: { findUnique: async () => null },
    manualPaymentRequest: {
      findFirst: async () => solicitud,
      updateMany: async ({ where, data }: any) => {
        if (solicitud.status !== where.status) return { count: 0 };
        Object.assign(solicitud, data);
        return { count: 1 };
      },
      update: async ({ data }: any) => Object.assign(solicitud, data),
    },
    tenant: { update: vi.fn(async () => ({})) },
    commission: { findMany: async () => [{ amount: 27, status: 'PENDING', recipientCode: { ownerName: 'Nicolás' } }] },
  };
  const tenants: any = {
    create: vi.fn(async () => ({ tenant: { id: 'ten-1' }, ownerTempPassword: 'temporal123' })),
    registerManualPayment: vi.fn(async () => ({})),
  };
  const referrals: any = { setTenantAssignment: vi.fn(async () => ({ ok: true })) };
  const svc = new PagosPorAprobarService(prisma, {} as any, tenants, referrals);
  const admin: any = { id: 'admin-1', role: 'SUPER_ADMIN', whiteLabelId: null };
  return { svc, solicitud, prisma, tenants, referrals, admin };
}

describe('aprobar un pago manual', () => {
  it('crea el negocio, registra el pago en USD, asigna al closer y deja la comisión', async () => {
    const { svc, solicitud, prisma, tenants, referrals, admin } = montar();
    const r = await svc.aprobar(admin, 'sol-1', {});
    // Cobró en pesos: a Contabilidad entra el precio del plan trimestral.
    expect(tenants.registerManualPayment).toHaveBeenCalledWith(
      'ten-1',
      expect.objectContaining({ amount: 150, currency: 'USD', method: 'NEQUI', paidAt: '2026-10-02T17:00:00.000Z' }),
      'admin-1',
    );
    // Y ese es el precio pactado: la base de su comisión y de sus renovaciones.
    expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 'ten-1' }, data: { subscriptionPriceUsd: 150 } });
    // El afiliado es el del ENLACE: nadie lo eligió a mano.
    expect(referrals.setTenantAssignment).toHaveBeenCalledWith('ten-1', 'code-nico', 'admin-1');
    // El pago va ANTES que la asignación: la comisión se calcula sobre el ciclo pagado.
    expect(tenants.registerManualPayment.mock.invocationCallOrder[0]).toBeLessThan(
      referrals.setTenantAssignment.mock.invocationCallOrder[0],
    );
    expect(solicitud.status).toBe('APROBADO');
    expect(r).toMatchObject({ tenantId: 'ten-1', ownerTempPassword: 'temporal123', amountUsd: 150 });
    expect(r.comisiones).toEqual([{ afiliado: 'Nicolás', monto: 27, estado: 'PENDING' }]);
  });

  it('quien aprueba puede corregir el monto en USD', async () => {
    const { svc, tenants, admin } = montar();
    await svc.aprobar(admin, 'sol-1', { amountUsd: 135 });
    expect(tenants.registerManualPayment).toHaveBeenCalledWith('ten-1', expect.objectContaining({ amount: 135 }), 'admin-1');
  });

  it('dos aprobaciones a la vez no crean dos negocios', async () => {
    const { svc, admin, tenants } = montar('APROBANDO');
    await expect(svc.aprobar(admin, 'sol-1', {})).rejects.toBeInstanceOf(ConflictException);
    expect(tenants.create).not.toHaveBeenCalled();
  });

  it('si algo falla, vuelve a pendiente con el error y el reintento NO crea otro negocio', async () => {
    const { svc, solicitud, tenants, referrals, admin } = montar();
    referrals.setTenantAssignment.mockRejectedValueOnce(new Error('se cayó la base'));
    await expect(svc.aprobar(admin, 'sol-1', {})).rejects.toThrow('se cayó la base');
    expect(solicitud).toMatchObject({ status: 'PENDIENTE', lastError: 'se cayó la base', createdTenantId: 'ten-1' });

    // Reintento: el pago ya estaba registrado (el registro lo rechaza) y se sigue.
    tenants.registerManualPayment.mockRejectedValueOnce(new ConflictException('Ya hay un pago registrado para este ciclo'));
    await svc.aprobar(admin, 'sol-1', {});
    expect(tenants.create).toHaveBeenCalledTimes(1);
    expect(solicitud.status).toBe('APROBADO');
  });

  it('una aprobada o rechazada no se vuelve a aprobar', async () => {
    for (const estado of ['APROBADO', 'RECHAZADO']) {
      const { svc, admin } = montar(estado);
      await expect(svc.aprobar(admin, 'sol-1', {})).rejects.toBeInstanceOf(ConflictException);
    }
  });

  it('rechazar exige el motivo, que es lo que el closer necesita para corregir', async () => {
    const { svc, solicitud, admin } = montar();
    await expect(svc.rechazar(admin, 'sol-1', '  ')).rejects.toThrow(/por qué/);
    await svc.rechazar(admin, 'sol-1', 'El comprobante no se lee');
    expect(solicitud).toMatchObject({ status: 'RECHAZADO', rejectReason: 'El comprobante no se lee' });
  });
});
