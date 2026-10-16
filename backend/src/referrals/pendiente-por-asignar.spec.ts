/**
 * «Pendientes por asignar vendedor» y «Venta directa» (Javier, 2026-10-16).
 *
 * El caso real: Habibi Bar Cantina pagó $432 por fuera (16-sep) y $68 por
 * Hotmart (17-sep), sin ningún `ReferralUse`, y no salía en ningún aviso.
 *
 * Dos cosas que no se pueden romper:
 *  1. La regla de quién está pendiente (pura).
 *  2. Que un negocio de venta directa NO genere comisión por ningún camino,
 *     ni siquiera una fila de $0,00.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  CODIGO_VENTA_DIRECTA,
  DATOS_CODIGO_VENTA_DIRECTA,
  codigoVentaDirectaEsSeguro,
  esAtribucionQueCobra,
  esCodigoVentaDirecta,
  esPendientePorAsignar,
  haCobrado,
  primerCobro,
} from './pendiente-por-asignar';
import { ReferralsService } from './referrals.service';
import { HotmartService } from '../billing/hotmart.service';
import { PendientesPorAsignarService } from './pendientes-por-asignar.service';
import { PendientesPorAsignarController } from './pendientes-por-asignar.controller';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';

const SEP_16 = new Date('2026-09-16T15:00:00Z');
const SEP_17 = new Date('2026-09-17T15:00:00Z');

describe('quién está pendiente por asignar vendedor', () => {
  it('Habibi Bar Cantina (pagó y no tiene a nadie) SÍ está pendiente', () => {
    expect(
      esPendientePorAsignar({
        haCobrado: haCobrado({ cobrosPagados: 2, status: 'ACTIVE', hotmartSubscriberCode: null }),
        ventaDirecta: false,
        atribuidoDirecto: false,
        grupo: null,
      }),
    ).toBe(true);
  });

  it('un pago MANUAL basta, aunque no tenga suscripción de Hotmart', () => {
    // Esto es lo que el aviso viejo no veía.
    expect(haCobrado({ cobrosPagados: 1, status: 'ACTIVE', hotmartSubscriberCode: null })).toBe(true);
    expect(haCobrado({ cobrosPagados: 1, status: 'SUSPENDED', hotmartSubscriberCode: null })).toBe(true);
  });

  it('sigue saliendo lo que salía antes: activo con suscripción real', () => {
    expect(haCobrado({ cobrosPagados: 0, status: 'ACTIVE', hotmartSubscriberCode: 'HP123' })).toBe(true);
  });

  it('cortesía, prueba, marca blanca o nada: no ha cobrado', () => {
    for (const code of ['comp-1', 'trial-1', 'manual-1', 'wl-1', 'sim-1', 'campaign-1', null]) {
      expect(haCobrado({ cobrosPagados: 0, status: 'ACTIVE', hotmartSubscriberCode: code })).toBe(false);
    }
    // Suspendido sin cobro en el libro tampoco.
    expect(haCobrado({ cobrosPagados: 0, status: 'SUSPENDED', hotmartSubscriberCode: 'HP1' })).toBe(false);
  });

  it('marcado como venta directa: deja de estar pendiente', () => {
    expect(
      esPendientePorAsignar({ haCobrado: true, ventaDirecta: true, atribuidoDirecto: false, grupo: null }),
    ).toBe(false);
  });

  it('con un vendedor activo no está pendiente', () => {
    expect(
      esPendientePorAsignar({ haCobrado: true, ventaDirecta: false, atribuidoDirecto: true, grupo: null }),
    ).toBe(false);
  });

  it('si nunca pagó no se lista, aunque no tenga vendedor', () => {
    expect(
      esPendientePorAsignar({ haCobrado: false, ventaDirecta: false, atribuidoDirecto: false, grupo: null }),
    ).toBe(false);
  });

  it('el miembro de un grupo con afiliado activo no está pendiente; el de un grupo sin afiliado sí', () => {
    const base = { haCobrado: true, ventaDirecta: false, atribuidoDirecto: false };
    expect(
      esPendientePorAsignar({ ...base, grupo: { referralCodeId: 'c1', referralCode: { isActive: true } } }),
    ).toBe(false);
    expect(esPendientePorAsignar({ ...base, grupo: { referralCodeId: null } })).toBe(true);
  });

  it('qué atribución cuenta como «alguien cobra»', () => {
    expect(esAtribucionQueCobra({ code: 'NICO1', role: 'AMBASSADOR', isActive: true })).toBe(true);
    expect(esAtribucionQueCobra({ code: 'VEND1', role: 'VENDOR', isActive: true })).toBe(true);
    // Código desactivado: no devenga, así que el negocio sigue sin nadie.
    expect(esAtribucionQueCobra({ code: 'NICO1', role: 'AMBASSADOR', isActive: false })).toBe(false);
    // El socio cobra sobre toda venta: no dice quién vendió.
    expect(esAtribucionQueCobra({ code: 'SOCIO1', role: 'SOCIO', isActive: true })).toBe(false);
    // La venta directa se cuenta aparte, no como vendedor.
    expect(esAtribucionQueCobra({ code: CODIGO_VENTA_DIRECTA, role: 'VENDOR', isActive: true })).toBe(false);
  });

  it('el primer cobro es el más antiguo por fecha de venta', () => {
    const p = primerCobro([
      { saleDate: SEP_17, grossUsd: 68, gateway: 'HOTMART' },
      { saleDate: SEP_16, grossUsd: 432, gateway: 'MANUAL' },
    ]);
    expect(p).toEqual({ saleDate: SEP_16, grossUsd: 432, gateway: 'MANUAL' });
    expect(primerCobro([])).toBeNull();
  });
});

describe('el código de venta directa', () => {
  it('nace como vendedor al 0 %, inactivo, sin padre ni enlace', () => {
    expect(DATOS_CODIGO_VENTA_DIRECTA).toMatchObject({
      code: 'VENTA_DIRECTA',
      role: 'VENDOR',
      commissionPercent: 0,
      isActive: false,
      slug: null,
      parentCodeId: null,
      parentEmbajadorCodeId: null,
    });
    expect(codigoVentaDirectaEsSeguro(DATOS_CODIGO_VENTA_DIRECTA)).toBe(true);
    // El webhook de Hotmart solo toma como afiliado ^[A-Z0-9]{4,20}$.
    expect(/^[A-Z0-9]{4,20}$/.test(CODIGO_VENTA_DIRECTA)).toBe(false);
    expect(esCodigoVentaDirecta(' venta_directa ')).toBe(true);
  });

  it('si alguien lo edita y le pone % o padre, deja de ser seguro', () => {
    const d = DATOS_CODIGO_VENTA_DIRECTA;
    expect(codigoVentaDirectaEsSeguro({ ...d, commissionPercent: 10 })).toBe(false);
    expect(codigoVentaDirectaEsSeguro({ ...d, fixedCommissionUsd: 30 })).toBe(false);
    expect(codigoVentaDirectaEsSeguro({ ...d, parentEmbajadorCodeId: 'emb' })).toBe(false);
    expect(codigoVentaDirectaEsSeguro({ ...d, role: 'AMBASSADOR' })).toBe(false);
  });
});

// ── «Venta directa» no genera comisión ───────────────────────────────────────

const VENTA_DIRECTA = {
  ...DATOS_CODIGO_VENTA_DIRECTA,
  id: 'code-venta-directa',
  maxCommissionPercent: null,
  parentCode: null,
  parentEmbajadorCode: null,
};

/** ReferralsService real, con base falsa: el negocio solo tiene la venta directa. */
function referralsCon(codigo: any) {
  const create = vi.fn(async ({ data }: any) => ({ id: 'nueva', ...data }));
  const commission = {
    create,
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
  };
  const svc = Object.create(ReferralsService.prototype) as any;
  svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  svc.recalc = { getCommissionBase: vi.fn(async () => 68) };
  svc.commissionExceptions = { resolvePercent: vi.fn(async (_t: string, _c: string, f: number) => f) };
  svc.slugForWhiteLabelId = vi.fn(async () => 'clubify');
  svc.getBrandCommissionMode = vi.fn(async () => 'PERCENTAGE');
  svc.prisma = {
    tenant: {
      findUnique: vi.fn(async () => ({
        subscriptionPriceUsd: null,
        planPeriodicity: 'MENSUAL',
        commissionDistributionMode: 'DISCOUNT_FROM_INFLUENCER',
        whiteLabelId: 'wl-clubify',
        lastChargeAt: SEP_17,
        currentPeriodEnd: new Date(Date.now() + 20 * 86400_000),
        suspendedAt: null,
        hotmartTransactionId: 'HP-HABIBI',
        plan: { priceMonthly: 68 },
      })),
    },
    referralUse: {
      findMany: vi.fn(async () => [
        { id: 'use-vd', createdAt: SEP_17, status: 'PAYING', referralCode: codigo },
      ]),
      findFirst: vi.fn(async () => ({ id: 'use-vd' })),
    },
    referralCode: { findUnique: vi.fn(async () => codigo) },
    setting: { findUnique: vi.fn(async () => null) },
    commission,
    $transaction: async (fn: any) => fn({ commission }),
  };
  return { svc, create };
}

describe('un negocio de venta directa no genera comisión', () => {
  it('el cobro (generateCommissionsForPayment) no crea ninguna fila', async () => {
    const { svc, create } = referralsCon(VENTA_DIRECTA);
    const r = await svc.generateCommissionsForPayment({
      tenantId: 't-habibi',
      paymentAmountUsd: 68,
      hotmartTransactionId: 'HP-HABIBI',
    });
    expect(r.generated).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('la comisión retroactiva al marcarlo (backfill de la asignación) tampoco', async () => {
    const { svc, create } = referralsCon(VENTA_DIRECTA);
    await svc.backfillCommissionForAssignment('use-vd', 't-habibi', VENTA_DIRECTA.id);
    expect(create).not.toHaveBeenCalled();
  });

  it('por qué VENDOR y no embajador: un embajador al 0 % dejaría una comisión de $0,00', async () => {
    // Documenta el punto ciego que decidió el diseño: la rama directa del
    // backfill crea la fila sin mirar si el monto es 0. Si un día esto deja de
    // pasar, se podría usar otro rol — pero no antes.
    const embajador0 = { ...VENTA_DIRECTA, role: 'AMBASSADOR' };
    const { svc, create } = referralsCon(embajador0);
    await svc.backfillCommissionForAssignment('use-vd', 't-habibi', embajador0.id);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.amount).toBe(0);
  });

  it('el cobro de Hotmart/Stripe/Cross (el enrutador real) no crea ninguna fila', async () => {
    // Se prueba el RESULTADO, no la rama: el enrutador decide entre el
    // generador de 3 vías y el flujo de embajador/influencer, y esa decisión
    // la está cambiando otro trabajo en paralelo (2026-10-16). Por cualquiera
    // de las dos, la venta directa no debe dejar comisión.
    const { svc, create } = referralsCon(VENTA_DIRECTA);
    const usoVd = { id: 'use-vd', status: 'PAYING', referralCode: VENTA_DIRECTA, commissions: [] };
    const rolCoincide = (filtro: any) =>
      filtro == null ||
      filtro === 'VENDOR' ||
      (Array.isArray(filtro?.in) && filtro.in.includes('VENDOR'));
    svc.prisma.referralUse.findFirst = vi.fn(async ({ where }: any) =>
      // El único ReferralUse del negocio es el de venta directa (VENDOR):
      // cualquier consulta que filtre por otro rol no lo encuentra.
      rolCoincide(where?.referralCode?.role) ? usoVd : null,
    );
    svc.prisma.referralUse.findMany = vi.fn(async ({ where }: any) =>
      rolCoincide(where?.referralCode?.role) ? [{ ...usoVd, createdAt: SEP_17 }] : [],
    );
    svc.getBrandCommissionModeByWhiteLabelId = vi.fn(async () => 'PERCENTAGE');
    const hot = Object.create(HotmartService.prototype) as any;
    hot.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    hot.prisma = svc.prisma;
    hot.referralsService = svc;
    hot.getCanonicalBundlePrice = vi.fn(async () => 68);
    hot.resolvePercent = vi.fn(async (_t: string, _c: string, f: number) => f);
    hot.getNumberSetting = vi.fn(async (_k: string, f: number) => f);
    await hot.generarComisionesDeCobro({ tenantId: 't-habibi', transaccionId: 'HP-HABIBI' });
    expect(create).not.toHaveBeenCalled();
    expect(hot.logger.warn).not.toHaveBeenCalled();
  });
});

// ── El servicio ──────────────────────────────────────────────────────────────

function servicioCon(datos: { usos?: any[]; cobros?: any[]; codigoExistente?: any }) {
  const creados: any[] = [];
  let codigo = datos.codigoExistente ?? null;
  const prisma: any = {
    whiteLabel: { findFirst: vi.fn(async () => ({ id: 'wl-clubify' })) },
    tenant: {
      findMany: vi.fn(async () => [
        {
          id: 't-habibi',
          brandName: 'Habibi Bar Cantina',
          status: 'ACTIVE',
          planPeriodicity: 'MENSUAL',
          hotmartSubscriberCode: 'HP-SUB',
          businessGroup: null,
        },
        {
          id: 't-gratis',
          brandName: 'Negocio de cortesía',
          status: 'ACTIVE',
          planPeriodicity: null,
          hotmartSubscriberCode: 'comp-1',
          businessGroup: null,
        },
      ]),
    },
    incomeRecord: {
      findMany: vi.fn(async () =>
        datos.cobros ?? [
          { tenantId: 't-habibi', saleDate: SEP_17, grossUsd: 68, gateway: 'HOTMART' },
          { tenantId: 't-habibi', saleDate: SEP_16, grossUsd: 432, gateway: 'MANUAL' },
        ],
      ),
    },
    referralUse: { findMany: vi.fn(async () => datos.usos ?? []) },
    referralCode: {
      findUnique: vi.fn(async () => codigo),
      create: vi.fn(async ({ data }: any) => {
        creados.push(data);
        codigo = { id: 'code-vd', ...data };
        return codigo;
      }),
    },
  };
  const referrals = { setTenantAssignment: vi.fn(async () => ({ ok: true })) };
  const audit = { log: vi.fn(async () => undefined) };
  const svc = new PendientesPorAsignarService(prisma, referrals as any, audit as any);
  return { svc, prisma, referrals, creados };
}

describe('PendientesPorAsignarService', () => {
  it('Habibi sale pendiente con su primer cobro (el manual de $432) y el total', async () => {
    const { svc } = servicioCon({});
    const r = await svc.listar();
    expect(r.pendientes.map((p) => p.brandName)).toEqual(['Habibi Bar Cantina']);
    expect(r.pendientes[0].primerCobro).toEqual({
      fecha: SEP_16.toISOString(),
      montoUsd: 432,
      pasarela: 'MANUAL',
    });
    expect(r.pendientes[0].totalUsd).toBe(500);
    expect(r.ventasDirectas).toEqual([]);
  });

  it('el socio no lo saca de pendientes; la venta directa sí, y lo lista aparte', async () => {
    const socio = servicioCon({
      usos: [{ tenantId: 't-habibi', createdAt: SEP_17, referralCode: { code: 'SOCIO1', role: 'SOCIO', isActive: true } }],
    });
    expect((await socio.svc.contar()).total).toBe(1);

    const vd = servicioCon({
      usos: [
        { tenantId: 't-habibi', createdAt: SEP_17, referralCode: { code: CODIGO_VENTA_DIRECTA, role: 'VENDOR', isActive: false } },
      ],
    });
    const r = await vd.svc.listar();
    expect(r.pendientes).toEqual([]);
    expect(r.ventasDirectas.map((v) => v.brandName)).toEqual(['Habibi Bar Cantina']);
  });

  it('crea el código de venta directa la primera vez, con los datos seguros', async () => {
    const { svc, creados } = servicioCon({});
    const id = await svc.asegurarCodigoVentaDirecta();
    expect(id).toBe('code-vd');
    expect(creados).toHaveLength(1);
    expect(creados[0]).toMatchObject({ code: 'VENTA_DIRECTA', role: 'VENDOR', commissionPercent: 0, isActive: false });
    // Segunda vez: no vuelve a crear.
    await svc.asegurarCodigoVentaDirecta();
    expect(creados).toHaveLength(1);
  });

  it('se niega a usar un código VENTA_DIRECTA que alguien editó con comisión', async () => {
    const { svc } = servicioCon({
      codigoExistente: { ...VENTA_DIRECTA, commissionPercent: 20 },
    });
    await expect(svc.asegurarCodigoVentaDirecta()).rejects.toThrow(/modificado/);
  });
});

describe('marcar venta directa', () => {
  function conAtribucionesPagadas(pagadas: any[]) {
    const { svc, prisma, referrals } = servicioCon({ codigoExistente: VENTA_DIRECTA });
    prisma.tenant.findFirst = vi.fn(async () => ({
      id: 't-habibi',
      brandName: 'Habibi Bar Cantina',
      businessGroupId: null,
    }));
    prisma.referralUse.findMany = vi.fn(async () => pagadas);
    return { svc, referrals };
  }
  const admin = { id: 'u-admin', role: 'SUPER_ADMIN' } as any;

  it('asigna el código de venta directa por el camino normal de asignación', async () => {
    const { svc, referrals } = conAtribucionesPagadas([]);
    await svc.marcarVentaDirecta(admin, 't-habibi');
    expect(referrals.setTenantAssignment).toHaveBeenCalledWith('t-habibi', VENTA_DIRECTA.id, 'u-admin');
  });

  it('se niega si queda viva una atribución con comisiones PAGADAS (le pagaría al de antes)', async () => {
    const { svc, referrals } = conAtribucionesPagadas([
      { referralCode: { code: 'NICO1', ownerName: 'Nicolás' } },
    ]);
    await expect(svc.marcarVentaDirecta(admin, 't-habibi')).rejects.toThrow(/Nicolás/);
    expect(referrals.setTenantAssignment).not.toHaveBeenCalled();
  });
});

describe('las rutas llevan el candado de la plataforma', () => {
  it('PendientesPorAsignarController tiene SoloPlataformaGuard en la clase', () => {
    const guards = (Reflect.getMetadata('__guards__', PendientesPorAsignarController) ?? []) as unknown[];
    expect(guards).toContain(SoloPlataformaGuard);
  });
});
