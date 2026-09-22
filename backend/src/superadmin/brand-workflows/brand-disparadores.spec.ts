import { describe, it, expect, vi } from 'vitest';
import { BrandWorkflowEngineService } from './brand-workflow-engine.service';
import { catalogoDeMarca } from './brand-workflow.util';

/**
 * Varios disparadores por flujo y sus filtros, en el motor de NEGOCIOS
 * (2026-09-22).
 *
 * Por qué estas pruebas: además de lo del motor de contactos (compatibilidad,
 * O entre disparadores, Y entre filtros), aquí los barridos de cada hora leían
 * UN número del flujo —`daysBefore`, `daysInactive`, `orders`—. Con dos
 * disparadores del mismo tipo («vence en 7 días» y «en 1 día»), el segundo se
 * ignoraba entero. Cada barrido tiene que contrastar a cada negocio con cada
 * disparador de su tipo.
 */

const MARCA = 'marca-sellea';
const DIA = 86400000;
const ahora = Date.now();

type Negocio = {
  id: string;
  whiteLabelId: string;
  status: string;
  name?: string;
  plan?: { name: string } | null;
  createdAt: Date;
  currentPeriodEnd?: Date | null;
  trialEndsAt?: Date | null;
};

/** Aplica un `where` de Prisma sencillo (igualdad, OR, gte/lte, in) sobre una fila falsa. */
function casa(fila: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, cond]: [string, any]) => {
    if (k === 'OR') return (cond as any[]).some((w) => casa(fila, w));
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const v = fila[k];
      if ('in' in cond) return cond.in.includes(v);
      if ('gte' in cond && !(v != null && v >= cond.gte)) return false;
      if ('lte' in cond && !(v != null && v <= cond.lte)) return false;
      if ('not' in cond) return v !== cond.not;
      return true;
    }
    return fila[k] === cond;
  });
}

function motor(opts: { flujos: any[]; negocios?: Negocio[]; pedidos?: { tenantId: string; createdAt: Date }[] }) {
  const negocios: Negocio[] = opts.negocios ?? [
    { id: 't1', whiteLabelId: MARCA, status: 'ACTIVE', name: 'Wok', plan: { name: 'Pro' }, createdAt: new Date(ahora - 400 * DIA) },
  ];
  const pedidos = opts.pedidos ?? [];
  const flujos = opts.flujos.map((f) => ({
    whiteLabelId: MARCA,
    status: 'published',
    rootId: 'r1',
    createdAt: new Date(ahora - 30 * DIA),
    triggers: [],
    ...f,
  }));
  const prisma: any = {
    tenant: {
      findUnique: async ({ where }: any) => {
        const n = negocios.find((x) => x.id === where.id);
        return n ? { ...n, planPeriodicity: 'MENSUAL', whiteLabel: { name: 'Sellea' } } : null;
      },
      findMany: async ({ where }: any) => negocios.filter((n) => casa(n, where)),
    },
    whiteLabel: { findFirst: async () => ({ id: 'marca-clubify' }) },
    user: { findFirst: async () => ({ fullName: 'Mauricio' }) },
    order: {
      count: async ({ where }: any) => pedidos.filter((p) => p.tenantId === where.tenantId).length,
      groupBy: async ({ where, _max }: any) => {
        const filas = pedidos.filter((p) => casa(p, where));
        const ids = [...new Set(filas.map((p) => p.tenantId))];
        return ids.map((tenantId) => {
          const suyos = filas.filter((p) => p.tenantId === tenantId);
          return _max
            ? { tenantId, _max: { createdAt: new Date(Math.max(...suyos.map((p) => p.createdAt.getTime()))) } }
            : { tenantId, _count: { _all: suyos.length } };
        });
      },
    },
    brandWorkflow: { findMany: async () => flujos.filter((f) => f.status === 'published') },
  };
  const enrolls: { wfId: string; tenantId: string; contexto?: any }[] = [];
  const svc = Object.create(BrandWorkflowEngineService.prototype) as any;
  svc.prisma = prisma;
  svc.grow = {};
  svc.log = { warn: vi.fn(), log: vi.fn() };
  svc.enroll = vi.fn(async (wfId: string, tenantId: string, contexto?: any) => {
    enrolls.push({ wfId, tenantId, contexto });
  });
  return { svc, enrolls };
}

describe('disparo en tiempo real (cobros, suspensiones)', () => {
  it('un flujo de ANTES (lista vacía) arranca por su `trigger` de siempre', async () => {
    const { svc, enrolls } = motor({ flujos: [{ id: 'viejo', trigger: { type: 'payment_failed' } }] });
    await svc.fireTrigger('payment_failed', 't1');
    expect(enrolls.map((e) => e.wfId)).toEqual(['viejo']);
  });

  it('el SEGUNDO disparador también arranca el flujo', async () => {
    const { svc, enrolls } = motor({
      flujos: [{ id: 'wf', trigger: { type: 'payment_failed' }, triggers: [{ type: 'payment_failed' }, { type: 'business_suspended' }] }],
    });
    await svc.fireTrigger('business_suspended', 't1');
    expect(enrolls).toEqual([
      { wfId: 'wf', tenantId: 't1', contexto: { disparador: 'Negocio suspendido #2', disparadorTipo: 'business_suspended' } },
    ]);
  });

  it('con lista, el `trigger` suelto ya no cuenta', async () => {
    const { svc, enrolls } = motor({ flujos: [{ id: 'wf', trigger: { type: 'payment_failed' }, triggers: [{ type: 'payment_approved' }] }] });
    await svc.fireTrigger('payment_failed', 't1');
    expect(enrolls).toEqual([]);
  });

  it('dentro de un disparador se exigen TODOS sus filtros; entre disparadores basta uno', async () => {
    const { svc, enrolls } = motor({
      flujos: [
        {
          id: 'wf',
          triggers: [
            // Pro Y más de 10 pedidos: el negocio tiene 0 → no casa.
            { type: 'payment_failed', filters: [{ field: 'plan', op: 'eq', value: 'pro' }, { field: 'pedidos', op: 'gt', value: '10' }] },
            // Solo plan Pro → casa.
            { type: 'payment_failed', filters: [{ field: 'plan', op: 'eq', value: 'pro' }] },
          ],
        },
      ],
    });
    await svc.fireTrigger('payment_failed', 't1');
    expect(enrolls[0]?.contexto?.disparador).toBe('Pago rechazado o demorado #2');
  });

  it('un operador desconocido no deja entrar', async () => {
    const { svc, enrolls } = motor({ flujos: [{ id: 'wf', triggers: [{ type: 'payment_failed', filters: [{ field: 'plan', op: 'like', value: 'pro' }] }] }] });
    await svc.fireTrigger('payment_failed', 't1');
    expect(enrolls).toEqual([]);
  });
});

describe('los barridos leen el número de CADA disparador', () => {
  it('suscripción por vencer: «7 días» y «1 día» en el mismo flujo', async () => {
    const negocios: Negocio[] = [
      { id: 'en5', whiteLabelId: MARCA, status: 'ACTIVE', createdAt: new Date(0), currentPeriodEnd: new Date(ahora + 5 * DIA) },
      { id: 'en12h', whiteLabelId: MARCA, status: 'ACTIVE', createdAt: new Date(0), currentPeriodEnd: new Date(ahora + 0.5 * DIA) },
      { id: 'en9', whiteLabelId: MARCA, status: 'ACTIVE', createdAt: new Date(0), currentPeriodEnd: new Date(ahora + 9 * DIA) },
    ];
    const { svc, enrolls } = motor({
      negocios,
      flujos: [
        {
          id: 'wf',
          trigger: { type: 'subscription_expiring', daysBefore: 1 },
          triggers: [
            { type: 'subscription_expiring', daysBefore: 1 },
            { type: 'subscription_expiring', daysBefore: 7 },
          ],
        },
      ],
    });
    await svc.scanSubscriptionExpiring();
    // El de 5 días solo lo recoge el disparador de 7; el de 12 h, el de 1 (el primero gana).
    expect(enrolls.map((e) => [e.tenantId, e.contexto.disparador]).sort()).toEqual([
      ['en12h', 'Suscripción por vencer #1'],
      ['en5', 'Suscripción por vencer #2'],
    ]);
  });

  it('un flujo de antes con un solo disparador mira el mismo tramo que antes', async () => {
    const negocios: Negocio[] = [
      { id: 'en2', whiteLabelId: MARCA, status: 'ACTIVE', createdAt: new Date(0), currentPeriodEnd: new Date(ahora + 2 * DIA) },
      { id: 'en4', whiteLabelId: MARCA, status: 'ACTIVE', createdAt: new Date(0), currentPeriodEnd: new Date(ahora + 4 * DIA) },
    ];
    const { svc, enrolls } = motor({ negocios, flujos: [{ id: 'viejo', trigger: { type: 'subscription_expiring' } }] });
    await svc.scanSubscriptionExpiring();
    // Sin `daysBefore`, 3 días como siempre.
    expect(enrolls.map((e) => e.tenantId)).toEqual(['en2']);
  });

  it('prueba por terminar, con dos disparadores y un filtro', async () => {
    const negocios: Negocio[] = [
      { id: 'pro', whiteLabelId: MARCA, status: 'TRIAL', plan: { name: 'Pro' }, createdAt: new Date(0), trialEndsAt: new Date(ahora + 4 * DIA) },
      { id: 'basico', whiteLabelId: MARCA, status: 'TRIAL', plan: { name: 'Básico' }, createdAt: new Date(0), trialEndsAt: new Date(ahora + 4 * DIA) },
    ];
    const { svc, enrolls } = motor({
      negocios,
      flujos: [
        {
          id: 'wf',
          triggers: [
            { type: 'trial_ending', daysBefore: 1 },
            { type: 'trial_ending', daysBefore: 5, filters: [{ field: 'plan', op: 'eq', value: 'pro' }] },
          ],
        },
      ],
    });
    await svc.scanTrialEnding();
    expect(enrolls.map((e) => e.tenantId)).toEqual(['pro']);
  });

  it('negocio inactivo: cada disparador con sus días', async () => {
    const negocios: Negocio[] = [
      // Último pedido hace 20 días: inactivo para «15 días», no para «30».
      { id: 'hace20', whiteLabelId: MARCA, status: 'ACTIVE', createdAt: new Date(ahora - 400 * DIA) },
      // Pidió ayer: activo para los dos.
      { id: 'ayer', whiteLabelId: MARCA, status: 'ACTIVE', createdAt: new Date(ahora - 400 * DIA) },
      // Nació hace 10 días: todavía no cuenta para ninguno.
      { id: 'nuevo', whiteLabelId: MARCA, status: 'ACTIVE', createdAt: new Date(ahora - 10 * DIA) },
    ];
    const pedidos = [
      { tenantId: 'hace20', createdAt: new Date(ahora - 20 * DIA) },
      { tenantId: 'ayer', createdAt: new Date(ahora - 1 * DIA) },
    ];
    const { svc, enrolls } = motor({
      negocios,
      pedidos,
      flujos: [
        {
          id: 'wf',
          triggers: [
            { type: 'business_inactive', daysInactive: 30 },
            { type: 'business_inactive', daysInactive: 15 },
          ],
        },
      ],
    });
    await svc.scanBusinessInactive();
    expect(enrolls.map((e) => [e.tenantId, e.contexto.disparador])).toEqual([['hace20', 'Negocio inactivo #2']]);
  });

  it('pedidos: «primer pedido» y «llegó a N» en el mismo flujo, sin inscribir dos veces', async () => {
    const negocios: Negocio[] = [
      { id: 'uno', whiteLabelId: MARCA, status: 'ACTIVE', createdAt: new Date(0) },
      { id: 'cinco', whiteLabelId: MARCA, status: 'ACTIVE', createdAt: new Date(0) },
    ];
    const pedidos = [
      { tenantId: 'uno', createdAt: new Date(ahora - DIA) },
      ...Array.from({ length: 5 }, () => ({ tenantId: 'cinco', createdAt: new Date(ahora - DIA) })),
    ];
    const { svc, enrolls } = motor({
      negocios,
      pedidos,
      flujos: [
        {
          id: 'wf',
          triggers: [
            { type: 'orders_milestone', orders: 5 },
            { type: 'first_order' },
          ],
        },
      ],
    });
    await svc.scanPedidos();
    // El flujo sale de las DOS consultas (una por tipo): se cuenta una vez.
    expect(enrolls.map((e) => [e.tenantId, e.contexto.disparadorTipo]).sort()).toEqual([
      ['cinco', 'orders_milestone'],
      ['uno', 'first_order'],
    ]);
  });

  it('negocio nuevo: aplica los filtros del disparador', async () => {
    const negocios: Negocio[] = [
      { id: 'pro', whiteLabelId: MARCA, status: 'ACTIVE', plan: { name: 'Pro' }, createdAt: new Date(ahora - DIA) },
      { id: 'basico', whiteLabelId: MARCA, status: 'ACTIVE', plan: { name: 'Básico' }, createdAt: new Date(ahora - DIA) },
    ];
    const { svc, enrolls } = motor({
      negocios,
      flujos: [{ id: 'wf', triggers: [{ type: 'business_created', filters: [{ field: 'plan', op: 'neq', value: 'pro' }] }] }],
    });
    await svc.scanBusinessCreated();
    expect(enrolls.map((e) => e.tenantId)).toEqual(['basico']);
  });
});

describe('el catálogo de negocios', () => {
  it('ofrece los 10 operadores sin los de etiqueta, y filtros en cada disparador automático', () => {
    const cat = catalogoDeMarca('STRIPE');
    expect(cat.operadores.map((o) => o.value)).not.toContain('has_tag');
    expect(cat.operadores).toHaveLength(10);
    const pago = cat.disparadores.find((d) => d.key === 'payment_failed')!;
    expect(pago.filtros?.campos.map((c) => c.key)).toContain('plan');
    expect(cat.disparadores.find((d) => d.key === 'manual')!.filtros?.campos).toEqual([]);
  });
});
