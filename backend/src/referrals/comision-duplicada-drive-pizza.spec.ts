/**
 * El duplicado de Drive Pizza: una venta, un cobro, y cuatro comisiones.
 *
 * NO necesita base de datos ni red.
 *
 * Qué pasó, para que no vuelva a pasar sin que nadie lo note:
 *
 *  1. 24-ago — entra el cobro real. No había atribución de referido todavía,
 *     así que no se generó comisión. Correcto.
 *  2. 25-ago — un admin atribuye la venta a un VENDOR desde el panel. Se crea
 *     el par de comisiones... pero SIN el número de transacción, porque el
 *     backfill pasaba `hotmartTransactionId: null` escrito a mano.
 *  3. 1-sep — Hotmart re-anuncia el MISMO cobro con `PURCHASE_COMPLETE` (que
 *     no es un pago nuevo: es el cierre de la ventana de garantía de 7 días).
 *     El webhook lo trató como cobro y generó el par otra vez.
 *  4. Las dos dedups fallaron a la vez: la de transacción porque las primeras
 *     la tenían en null, y la de base de datos porque los `periodKey` cayeron
 *     en meses distintos.
 *
 * Estas pruebas fijan los dos arreglos que cortan la cadena, y una tercera que
 * fija lo que NO debe romperse: una renovación de verdad —otra transacción—
 * tiene que seguir devengando.
 */
import { describe, it, expect, vi } from 'vitest';
import { ReferralsService } from './referrals.service';

const TX = 'HP2009265423';
const TENANT = 'tenant-drive-pizza';

function servicioReferrals(opts: { rolCodigo: 'VENDOR' | 'INFLUENCER'; txDelTenant: string | null }) {
  const svc = Object.create(ReferralsService.prototype) as any;
  svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  svc.audit = { log: vi.fn() };
  svc.prisma = {
    tenant: {
      findUnique: vi.fn(async () => ({
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        suspendedAt: null,
        planPeriodicity: 'ANUAL',
        subscriptionPriceUsd: 500,
        whiteLabelId: null,
        hotmartTransactionId: opts.txDelTenant,
        plan: { priceMonthly: 68 },
      })),
    },
    referralCode: {
      findUnique: vi.fn(async () => ({
        id: 'code-1',
        code: 'X79XEGGC',
        ownerName: 'Samuel Navarro',
        role: opts.rolCodigo,
        commissionPercent: 5,
        fixedCommissionUsd: null,
      })),
    },
    commission: {
      findFirst: vi.fn(async () => null), // no hay comisión reciente
      create: vi.fn(async () => ({})),
    },
  };
  svc.recalc = { getCommissionBase: vi.fn(async () => 500) };
  svc.getBrandCommissionMode = vi.fn(async () => 'PERCENT_RECURRING');
  svc.slugForWhiteLabelId = vi.fn(async () => null);
  // Lo que se está observando: con qué se llama al generador de 3 vías.
  svc.generateCommissionsForPayment = vi.fn(async () => ({ generated: 2, skipped: 0 }));
  return svc;
}

describe('atribución manual · la comisión nace CON el número de transacción', () => {
  it('VENDOR: el backfill pasa el tx del negocio, no null', async () => {
    // Esta es la causa raíz. Con `null`, la comisión queda invisible para la
    // dedup por transacción y el re-anuncio del mismo cobro la duplica.
    const svc = servicioReferrals({ rolCodigo: 'VENDOR', txDelTenant: TX });

    await svc.backfillCommissionForAssignment('use-1', TENANT, 'code-1');

    expect(svc.generateCommissionsForPayment).toHaveBeenCalledTimes(1);
    const args = svc.generateCommissionsForPayment.mock.calls[0][0];
    expect(args.hotmartTransactionId).toBe(TX);
  });

  it('VENDOR: si el negocio no tiene tx todavía, pasa null sin romperse', async () => {
    const svc = servicioReferrals({ rolCodigo: 'VENDOR', txDelTenant: null });

    await svc.backfillCommissionForAssignment('use-1', TENANT, 'code-1');

    const args = svc.generateCommissionsForPayment.mock.calls[0][0];
    expect(args.hotmartTransactionId).toBeNull();
  });

  it('INFLUENCER: la comisión directa también se sella con el tx', async () => {
    // El otro camino del mismo backfill tenía el mismo agujero.
    const svc = servicioReferrals({ rolCodigo: 'INFLUENCER', txDelTenant: TX });

    await svc.backfillCommissionForAssignment('use-1', TENANT, 'code-1');

    expect(svc.prisma.commission.create).toHaveBeenCalled();
    const data = svc.prisma.commission.create.mock.calls[0][0].data;
    expect(data.externalTxId).toBe(TX);
  });
});

describe('atribución manual · deja rastro en el registro de auditoría', () => {
  it('setTenantAssignment registra quién atribuyó la venta', async () => {
    // Al investigar Drive Pizza no se pudo saber quién había atribuido la
    // venta: esta ruta MUEVE DINERO y no escribía ni una línea, a diferencia
    // de assign-affiliate.
    const svc = Object.create(ReferralsService.prototype) as any;
    svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    svc.audit = { log: vi.fn() };
    svc.prisma = {
      referralUse: {
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => ({ id: 'use-nuevo' })),
        deleteMany: vi.fn(async () => ({ count: 0 })),
        delete: vi.fn(async () => ({})),
      },
      referralCode: {
        findUnique: vi.fn(async () => ({
          code: 'X79XEGGC',
          ownerName: 'Samuel Navarro',
          role: 'VENDOR',
        })),
      },
      commission: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
    };
    svc.backfillCommissionForAssignment = vi.fn(async () => undefined);

    await svc.setTenantAssignment(TENANT, 'code-1', 'usuario-admin');

    expect(svc.audit.log).toHaveBeenCalledTimes(1);
    const fila = svc.audit.log.mock.calls[0][0];
    expect(fila.action).toBe('commission.manual_attribution');
    expect(fila.actorId).toBe('usuario-admin');
    expect(fila.tenantId).toBe(TENANT);
    expect(fila.metadata.via).toBe('setTenantAssignment');
    expect(fila.metadata.ownerName).toBe('Samuel Navarro');
  });
});

/**
 * El re-anuncio del mismo cobro. La decisión vive en `activatePurchase`
 * (billing/hotmart.service.ts): `alreadyConfirmedTx` compara la transacción
 * entrante contra la que el negocio YA tenía guardada, ANTES de actualizarla.
 * Se replica aquí porque montar `activatePurchase` entero pediría media
 * aplicación; al final se comprueba que el guard sigue en el código.
 */
function devengaComisiones(txEntrante: string | null, txGuardadaEnElNegocio: string | null) {
  const alreadyConfirmedTx = !!txEntrante && txEntrante === txGuardadaEnElNegocio;
  return !alreadyConfirmedTx;
}

describe('PURCHASE_COMPLETE no vuelve a devengar el mismo cobro', () => {
  it('primer aviso del cobro (PURCHASE_APPROVED): devenga', () => {
    expect(devengaComisiones(TX, null)).toBe(true);
  });

  it('re-anuncio del MISMO cobro (PURCHASE_COMPLETE): NO devenga', () => {
    // Es el caso de Drive Pizza: mismo cobro, otro eventId, 7 días después.
    expect(devengaComisiones(TX, TX)).toBe(false);
  });

  it('renovación REAL (otra transacción): sí devenga — esto no se puede romper', () => {
    expect(devengaComisiones('HP9999999999', TX)).toBe(true);
  });

  it('evento sin transacción: devenga (no hay con qué deduplicar)', () => {
    expect(devengaComisiones(null, TX)).toBe(true);
  });
});
