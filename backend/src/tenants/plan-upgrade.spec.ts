/**
 * UPGRADE A PLAN ANUAL — lo que tiene que pasar y lo que NUNCA puede pasar.
 *
 * NO necesita base de datos ni red.
 *
 * La transacción está simulada de verdad: lo que escriben los pasos se queda en
 * un borrador y solo se «aplica» si la función entera termina bien. Así la
 * prueba de «si la comisión falla no queda nada a medias» dice algo — con un
 * mock que aplica todo al vuelo, esa prueba pasaría incluso sin atomicidad.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlanUpgradeService } from './plan-upgrade.service';

// «Hoy» fijo: hay reglas que miran el reloj (la fecha no puede ser futura ni de
// hace más de 30 días, el hold de 15 días). El 29 de febrero a mediodía UTC,
// para que la prueba de fin de mes use la fecha de hoy sin inventar nada.
const HOY = new Date('2028-02-29T12:00:00.000Z');
const DIA = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(HOY);
});
afterEach(() => {
  vi.useRealTimers();
});

type Opciones = {
  periodicidad?: string | null;
  status?: string;
  plan?: { id: string; name: string } | null;
  currentPeriodEnd?: Date | null;
  hotmartSubscriberCode?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  whiteLabelId?: string | null;
  /** El override `subscriptionPriceUsd` del negocio (el precio pactado). */
  precioPactado?: number | null;
  /** Cadena de atribución. null = negocio sin afiliado. */
  cadena?: any;
  excepciones?: Record<string, number>;
  /** La marca paga comisión FIJA por referido (Sellea). */
  marcaPagoUnico?: boolean;
  /** Simula que la creación de la comisión revienta. */
  comisionRevienta?: boolean;
  sinReferralUse?: boolean;
  upgrades?: any[];
  /** Enlace de pago del plan ANUAL de la marca. */
  enlaceAnual?: any;
  eventosHotmart?: any[];
  eventosStripe?: any[];
  /** El ingreso de esa transacción YA está en Contabilidad (y cómo lo dejó
   *  el camino de cobro: RENOVACION por el precio del plan VIEJO). */
  ingresoYaExiste?: boolean | any;
  /** El webhook de la pasarela YA creó la(s) comisión(es) de ese cobro. */
  comisionesDeLaPasarela?: any[];
  /** Comisiones del negocio creadas después del upgrade (guardián). */
  comisionesPosteriores?: any[];
  /** Comisiones vivas del negocio SIN `baseAmountUsd` congelado. */
  comisionesVivasSinBase?: any[];
  /** Los `ReferralUse` del negocio. Un CHURNED es lo que deja la cancelación
   *  en la pasarela que este mismo flujo exige hacer antes de cobrar. */
  usos?: Array<{ id: string; status: string }>;
  /** La base de comisión del negocio ANTES del upgrade. */
  baseActual?: number;
  /** El UPDATE condicional del guardián no encuentra fila que mover. */
  restauracionSinEfecto?: boolean;
};

const CADENA_VACIA = {
  influencer: null,
  embajador: null,
  vendor: null,
  sourceCodeId: null,
};

const CADENA_INFLUENCER = {
  influencer: { id: 'inf', commissionPercent: 25 },
  embajador: null,
  vendor: null,
  sourceCodeId: 'inf',
};

function servicio(opts: Opciones = {}) {
  const svc = Object.create(PlanUpgradeService.prototype) as any;
  svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  svc.audit = { log: vi.fn() };

  // `any`: el guardián le escribe campos que este molde no declara (los dedup
  // de aviso), y la prueba los comprueba.
  const negocio: any = {
    id: 'neg-1',
    brandName: 'Birria León',
    email: 'hola@birrialeon.test',
    status: opts.status ?? 'ACTIVE',
    deletedAt: null,
    whiteLabelId: opts.whiteLabelId ?? null,
    planId: 'plan-pro',
    plan: opts.plan === undefined ? { id: 'plan-pro', name: 'Pro' } : opts.plan,
    planPeriodicity: opts.periodicidad === undefined ? 'MENSUAL' : opts.periodicidad,
    subscriptionPriceUsd: opts.precioPactado ?? null,
    currentPeriodEnd: opts.currentPeriodEnd ?? new Date('2028-03-20T12:00:00.000Z'),
    commissionDistributionMode: 'DISCOUNT_FROM_INFLUENCER',
    // `??` no sirve aquí: pasar `null` a propósito (negocio sin suscripción)
    // caería al valor por defecto y la prueba diría lo contrario de lo que cree.
    hotmartSubscriberCode:
      opts.hotmartSubscriberCode === undefined
        ? 'SUB-REAL-123'
        : opts.hotmartSubscriberCode,
    stripeSubscriptionId: opts.stripeSubscriptionId ?? null,
    stripeCustomerId: opts.stripeCustomerId ?? null,
  };

  const upgrades: any[] = opts.upgrades ?? [];
  // Los `ReferralUse` del negocio. Por defecto uno vivo; `cadena: null` = no
  // hay ninguno (negocio sin afiliado).
  const usos: any[] =
    opts.usos ?? (opts.cadena === null ? [] : [{ id: 'use-1', status: 'PAYING' }]);
  const comisionesDeLaPasarela: any[] = opts.comisionesDeLaPasarela ?? [];

  // Lo que quedó escrito DE VERDAD (transacción confirmada).
  const aplicado: Record<string, any[]> = {
    manualPayment: [],
    tenant: [],
    income: [],
    incomeUpdate: [],
    commission: [],
    commissionUpdate: [],
    basesCongeladas: [],
    referralUse: [],
    referralUseUpdate: [],
  };

  const nuevoBorrador = () => ({
    manualPayment: [] as any[],
    tenant: [] as any[],
    income: [] as any[],
    incomeUpdate: [] as any[],
    commission: [] as any[],
    commissionUpdate: [] as any[],
    basesCongeladas: [] as any[],
    referralUse: [] as any[],
    referralUseUpdate: [] as any[],
  });
  let borrador = nuevoBorrador();

  const tx = {
    manualPayment: {
      create: vi.fn(async ({ data }: any) => {
        borrador.manualPayment.push(data);
        return { id: `mp-${borrador.manualPayment.length}`, ...data };
      }),
    },
    tenant: {
      update: vi.fn(async ({ data }: any) => {
        borrador.tenant.push(data);
        return { id: negocio.id, ...data };
      }),
    },
    incomeRecord: {
      findUnique: vi.fn(async () =>
        opts.ingresoYaExiste
          ? typeof opts.ingresoYaExiste === 'object'
            ? opts.ingresoYaExiste
            : {
                id: 'inc-de-la-pasarela',
                // Como lo deja el camino de cobro: el precio del plan VIEJO y
                // categoría RENOVACION.
                grossUsd: 68,
                category: 'RENOVACION',
                planPeriodicity: null,
              }
          : null,
      ),
      create: vi.fn(async ({ data }: any) => {
        borrador.income.push(data);
        return { id: `inc-${borrador.income.length}` };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        borrador.incomeUpdate.push({ id: where.id, ...data });
        return { id: where.id, ...data };
      }),
    },
    commission: {
      findMany: vi.fn(async () => comisionesDeLaPasarela),
      create: vi.fn(async ({ data }: any) => {
        if (opts.comisionRevienta) {
          throw new Error('no se pudo crear la comisión');
        }
        borrador.commission.push(data);
        return { id: `com-${borrador.commission.length}` };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        borrador.commissionUpdate.push({ id: where.id, ...data });
        return { id: where.id, ...data };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        borrador.basesCongeladas.push({ ids, ...data });
        return { count: ids.length };
      }),
    },
    referralUse: {
      create: vi.fn(async ({ data }: any) => {
        borrador.referralUse.push(data);
        return { id: 'use-socio' };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const afectados = usos.filter((u) => u.status === where.status);
        borrador.referralUseUpdate.push({ ids: afectados.map((u) => u.id), ...data });
        return { count: afectados.length };
      }),
    },
    planUpgrade: {
      // Espeja el UPDATE CONDICIONAL de verdad: si el acta ya no está en uno de
      // los estados del `where`, no toca nada y devuelve count 0.
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = upgrades.find(
          (u) =>
            u.id === where.id &&
            (where.estado?.in ? where.estado.in.includes(u.estado) : true),
        );
        if (!row) return { count: 0 };
        // El ÚNICO de `gatewayTxId`: un aviso repetido choca aquí.
        if (
          data.gatewayTxId &&
          upgrades.some(
            (u) => u.id !== row.id && u.gatewayTxId === data.gatewayTxId,
          )
        ) {
          const e: any = new Error('unique gatewayTxId');
          e.code = 'P2002';
          throw e;
        }
        Object.assign(row, data);
        return { count: 1 };
      }),
      findUnique: vi.fn(async ({ where }: any) =>
        upgrades.find((u) => u.id === where.id) ?? null,
      ),
    },
  };

  svc.prisma = {
    tenant: {
      findFirst: vi.fn(async () => negocio),
      findUnique: vi.fn(async () => negocio),
      updateMany: vi.fn(async ({ data }: any) => {
        if (opts.restauracionSinEfecto) return { count: 0 };
        Object.assign(negocio, data);
        return { count: 1 };
      }),
    },
    planUpgrade: {
      findUnique: vi.fn(async ({ where }: any) =>
        upgrades.find((u) =>
          where.operationRef
            ? u.operationRef === where.operationRef
            : u.id === where.id,
        ) ?? null,
      ),
      findFirst: vi.fn(async ({ where }: any) =>
        upgrades.find(
          (u) =>
            u.tenantId === where.tenantId &&
            (where.estado?.in ? where.estado.in.includes(u.estado) : true) &&
            (where.id ? u.id === where.id : true),
        ) ?? null,
      ),
      findMany: vi.fn(async ({ where }: any = {}) =>
        upgrades.filter((u) => {
          if (typeof where?.estado === 'string' && u.estado !== where.estado) {
            return false;
          }
          if (where?.estado?.in && !where.estado.in.includes(u.estado)) {
            return false;
          }
          if (where?.metodo && u.metodo !== where.metodo) return false;
          if (where?.cancelacionEstado?.in) {
            return where.cancelacionEstado.in.includes(u.cancelacionEstado);
          }
          if (where?.cobroViejoDetectadoAt?.not === null) {
            return u.cobroViejoDetectadoAt != null;
          }
          if (where?.comisionOmitidaMotivo?.startsWith) {
            return String(u.comisionOmitidaMotivo ?? '').startsWith(
              where.comisionOmitidaMotivo.startsWith,
            );
          }
          return true;
        }),
      ),
      create: vi.fn(async ({ data }: any) => {
        if (upgrades.some((u) => u.operationRef === data.operationRef)) {
          const e: any = new Error('unique operationRef');
          e.code = 'P2002';
          throw e;
        }
        // El único PARCIAL de la base: un solo upgrade vivo por negocio.
        if (
          upgrades.some(
            (u) =>
              u.tenantId === data.tenantId &&
              ['PENDIENTE', 'COMPLETADO'].includes(u.estado),
          )
        ) {
          const e: any = new Error('unique tenant vivo');
          e.code = 'P2002';
          throw e;
        }
        const row = {
          id: `upg-${upgrades.length + 1}`,
          createdAt: new Date(),
          comisionesCreadas: 0,
          commissionAmount: null,
          cobroViejoVeces: 0,
          ...data,
        };
        upgrades.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = upgrades.find((u) => u.id === where.id);
        for (const [k, v] of Object.entries(data ?? {})) {
          if (v && typeof v === 'object' && 'increment' in (v as any)) {
            row[k] = (row[k] ?? 0) + (v as any).increment;
          } else {
            row[k] = v;
          }
        }
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const filas = upgrades.filter((u) => {
          if (where.id?.in ? !where.id.in.includes(u.id) : where.id !== u.id) {
            return false;
          }
          if ('cancelacionAlertaAt' in where) {
            return u.cancelacionAlertaAt == null;
          }
          if ('cobroViejoDetectadoAt' in where) {
            return u.cobroViejoDetectadoAt == null;
          }
          if (where.estado?.not) return u.estado !== where.estado.not;
          // El acta solo pasa a FALLIDO si sigue viva: un CANCELADO no se pisa
          // (si no, el barrido acabaría aplicando un upgrade anulado).
          if (where.estado?.in) return where.estado.in.includes(u.estado);
          return true;
        });
        for (const f of filas) Object.assign(f, data);
        return { count: filas.length };
      }),
    },
    referralUse: {
      findFirst: vi.fn(async () =>
        opts.sinReferralUse ? null : (usos[0] ?? null),
      ),
      count: vi.fn(async () => usos.length),
    },
    commission: {
      // Dos llamadas distintas comparten este mock: la del guardián (comisiones
      // POSTERIORES al upgrade) y la del propio upgrade (comisiones vivas SIN
      // base congelada). Se distinguen por el filtro de `baseAmountUsd`.
      findMany: vi.fn(async ({ where }: any = {}) =>
        where?.baseAmountUsd === null
          ? (opts.comisionesVivasSinBase ?? [])
          : (opts.comisionesPosteriores ?? []),
      ),
    },
    setting: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.key === 'referrals.indirectPercent' ? { value: '5' } : null,
      ),
    },
    referralCode: { findUnique: vi.fn(async () => null) },
    whiteLabelPaymentLink: {
      findFirst: vi.fn(async () =>
        opts.enlaceAnual === undefined
          ? {
              id: 'link-anual',
              name: 'Anual',
              url: 'https://pay.example/anual',
              amountUsd: 500,
              gateway: 'HOTMART',
              stripePriceId: null,
            }
          : opts.enlaceAnual,
      ),
    },
    hotmartWebhookEvent: {
      findMany: vi.fn(async () => opts.eventosHotmart ?? []),
    },
    stripeWebhookEvent: {
      findMany: vi.fn(async () => opts.eventosStripe ?? []),
    },
    // Transacción de verdad: el borrador solo se aplica si todo sale bien.
    $transaction: vi.fn(async (fn: any) => {
      borrador = nuevoBorrador();
      try {
        const r = await fn(tx);
        for (const k of Object.keys(borrador)) {
          aplicado[k].push(...(borrador as any)[k]);
        }
        // Los `ReferralUse` revividos solo cambian de estado si la transacción
        // se confirma: así una prueba puede comprobar que un rollback los deja
        // como estaban.
        for (const cambio of borrador.referralUseUpdate) {
          for (const u of usos) {
            if (cambio.ids.includes(u.id)) u.status = cambio.status;
          }
        }
        return r;
      } catch (e) {
        borrador = nuevoBorrador(); // rollback
        throw e;
      }
    }),
  };

  svc.recalc = {
    getBundlePrice: vi.fn(async () => 500),
    // La base de comisión del negocio HOY, antes de que el upgrade la suba a
    // los $500 del anual. Es la que se congela en las comisiones vivas.
    getCommissionBase: vi.fn(async () => opts.baseActual ?? 68),
  };
  svc.income = {
    desglose: vi.fn(async () => ({ fee: 0, tax: 0, netExpected: 0 })),
  };
  svc.referrals = {
    getBrandCommissionModeByWhiteLabelId: vi.fn(async () =>
      opts.marcaPagoUnico ? 'FIXED_ONCE' : 'PERCENT_RECURRING',
    ),
    // Espeja lo que hace el motor: sin `incluirChurned` solo mira los use
    // VIVOS, así que un negocio al que la cancelación en la pasarela le dejó
    // todos los use en CHURNED devuelve cadena VACÍA.
    getAttributionChain: vi.fn(async (_id: string, o: any = {}) => {
      const cadena =
        opts.cadena === undefined ? CADENA_INFLUENCER : (opts.cadena ?? CADENA_VACIA);
      const hayVivos = usos.some((u) => u.status !== 'CHURNED');
      if (!usos.length) return CADENA_VACIA;
      if (!hayVivos && !o.incluirChurned) return CADENA_VACIA;
      return cadena;
    }),
  };
  svc.excepciones = {
    resolvePercent: vi.fn(
      async (_t: string, codeId: string, fallback: number) =>
        opts.excepciones?.[codeId] ?? fallback,
    ),
  };

  return { svc, negocio, upgrades, aplicado, tx, usos };
}

const dto = (extra: Partial<Record<string, any>> = {}) => ({
  operationRef: 'op-upgrade-0001',
  paidAmountUsd: 350,
  metodoDePago: 'NEQUI' as const,
  // El negocio de las pruebas tiene suscripción viva en Hotmart: sin esto el
  // POST se niega, y eso tiene su propio bloque de pruebas más abajo.
  suscripcionAnteriorCancelada: true,
  ...extra,
});

describe('upgrade a anual · el negocio queda en ANUAL con su nueva renovación', () => {
  for (const desde of ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL'] as const) {
    it(`desde ${desde}: periodicidad ANUAL y próxima renovación a 12 meses`, async () => {
      const { svc, aplicado } = servicio({ periodicidad: desde });

      const r = await svc.crear('neg-1', dto(), 'admin-1');

      expect(r.estado).toBe('COMPLETADO');
      expect(r.de).toBe(desde);
      expect(r.a).toBe('ANUAL');
      const [cambio] = aplicado.tenant;
      expect(cambio.planPeriodicity).toBe('ANUAL');
      // 29-feb-2028 + 12 meses = 28-feb-2029: el día se acota al último del mes
      // destino. Con un `setMonth` a secas (lo que hace change-plan-period) esto
      // habría saltado al 1 de marzo.
      expect(cambio.currentPeriodEnd.toISOString().slice(0, 10)).toBe('2029-02-28');
      expect(r.nextRenewalAt.toISOString().slice(0, 10)).toBe('2029-02-28');
    });
  }

  it('el ciclo del cobro cubre un AÑO, no el mes de la periodicidad vieja', async () => {
    // `resolveManualPaymentPeriod` lee la periodicidad DEL NEGOCIO, que en este
    // momento todavía es MENSUAL. Si no se le pasa ANUAL a mano, el pago sale
    // cubriendo 30 días y el negocio aparece vencido al mes siguiente.
    const { svc, aplicado } = servicio({ periodicidad: 'MENSUAL' });

    await svc.crear('neg-1', dto(), 'admin-1');

    const [pago] = aplicado.manualPayment;
    expect(pago.periodicity).toBe('ANUAL');
    expect(pago.periodEnd.toISOString().slice(0, 10)).toBe('2029-02-28');
  });

  it('limpia los avisos del ciclo viejo: si no, el negocio no recibe ninguno del nuevo', async () => {
    const { svc, aplicado } = servicio();

    await svc.crear('neg-1', dto(), 'admin-1');

    const [cambio] = aplicado.tenant;
    for (const campo of [
      'preReminder7dSentFor',
      'preReminder3dSentFor',
      'preReminderTodaySentFor',
      'paymentReminderSentFor',
      'paymentFailureNoticeSentAt',
      'pausePendingNoticeSentAt',
    ]) {
      expect(cambio[campo]).toBeNull();
    }
  });
});

describe('upgrade a anual · el monto pagado manda en la comisión', () => {
  it('pagó 350: la comisión es $87,50 (25 %), no los $125 del anual de lista', async () => {
    const { svc, aplicado } = servicio({ periodicidad: 'TRIMESTRAL' });

    const r = await svc.crear('neg-1', dto({ paidAmountUsd: 350 }), 'admin-1');

    expect(aplicado.commission).toHaveLength(1);
    const [c] = aplicado.commission;
    expect(c.amount).toBe(87.5);
    expect(Number(c.baseAmountUsd)).toBe(350);
    expect(c.appliedPercent).toBe(25);
    expect(r.commissionAmount).toBe(87.5);
    expect(r.comisionesCreadas).toBe(1);
  });

  it('el monto se redondea a céntimos ANTES de repartir nada', async () => {
    // Un 350.004 llegado de un formulario daría una comisión de 87.501 y una
    // base con tres decimales que nadie puede cuadrar contra el comprobante.
    const { svc, aplicado } = servicio();

    const r = await svc.crear('neg-1', dto({ paidAmountUsd: 350.004 }), 'admin-1');

    expect(r.paidAmountUsd).toBe(350);
    expect(Number(aplicado.commission[0].baseAmountUsd)).toBe(350);
    expect(aplicado.manualPayment[0].amount).toBe(350);
    expect(aplicado.income[0].grossUsd).toBe(350);
  });

  it('la comisión lleva la fecha del cobro y se desbloquea 15 días después', async () => {
    const { svc, aplicado } = servicio();

    await svc.crear('neg-1', dto(), 'admin-1');

    const [c] = aplicado.commission;
    expect(c.businessDate).toEqual(HOY);
    expect(c.availableAt).toEqual(new Date(HOY.getTime() + 15 * DIA));
  });

  it('el periodKey del upgrade no es el del mes: el UNIQUE no lo puede frenar', async () => {
    const { svc, aplicado, upgrades } = servicio();

    await svc.crear('neg-1', dto(), 'admin-1');

    const [c] = aplicado.commission;
    expect(c.periodKey).toBe(`UPG-2028-02-${upgrades[0].id}`);
    expect(c.periodKey).not.toBe('2028-02');
  });

  it('respeta la excepción de % del negocio, igual que el motor', async () => {
    const { svc, aplicado } = servicio({ excepciones: { inf: 20 } });

    await svc.crear('neg-1', dto({ paidAmountUsd: 350 }), 'admin-1');

    expect(aplicado.commission[0].amount).toBe(70);
    expect(aplicado.commission[0].appliedPercent).toBe(20);
  });

  it('negocio sin afiliado: se aplica igual y queda dicho por qué no hubo comisión', async () => {
    const { svc, aplicado } = servicio({ cadena: null });

    const r = await svc.crear('neg-1', dto(), 'admin-1');

    expect(r.estado).toBe('COMPLETADO');
    expect(aplicado.commission).toHaveLength(0);
    expect(r.comisionOmitidaMotivo).toBe('sin-afiliado');
  });

  it('marca de pago único (Sellea): un upgrade NO dispara otro monto fijo', async () => {
    const { svc, aplicado } = servicio({ marcaPagoUnico: true });

    const r = await svc.crear('neg-1', dto(), 'admin-1');

    expect(aplicado.commission).toHaveLength(0);
    expect(r.comisionOmitidaMotivo).toBe('marca-pago-unico');
  });
});

describe('upgrade a anual · el precio pactado viejo se retira', () => {
  it('un negocio con precio pactado de $50 lo pierde: la renovación anual no se comisiona sobre $50', async () => {
    // El override gana en `getCommissionBase` y en el webhook. Dejarlo haría
    // que la renovación ANUAL del año que viene se comisionara sobre los $50
    // del mensual legacy, que es justo lo contrario de lo pactado.
    const { svc, aplicado } = servicio({ precioPactado: 50 });

    const r = await svc.crear('neg-1', dto(), 'admin-1');

    const [cambio] = aplicado.tenant;
    expect(cambio.subscriptionPriceUsd).toBeNull();
    // El valor anterior no se pierde: queda congelado en el acta.
    expect(r.precioPactadoAnterior).toBe(50);
  });

  it('sin precio pactado no se toca el campo (no se escribe por escribir)', async () => {
    const { svc, aplicado } = servicio({ precioPactado: null });

    const r = await svc.crear('neg-1', dto({ paidAmountUsd: 350 }), 'admin-1');

    const [cambio] = aplicado.tenant;
    expect(Object.keys(cambio)).not.toContain('subscriptionPriceUsd');
    expect(r.precioPactadoAnterior).toBeNull();
  });

  it('NUNCA escribe lo pagado como precio del negocio', async () => {
    const { svc, aplicado } = servicio({ precioPactado: 135 });

    await svc.crear('neg-1', dto({ paidAmountUsd: 350 }), 'admin-1');

    const [cambio] = aplicado.tenant;
    expect(cambio.subscriptionPriceUsd).not.toBe(350);
    expect(cambio.subscriptionPriceUsd).toBeNull();
  });

  it('la previsualización lo avisa antes de que nadie pulse nada', async () => {
    const { svc } = servicio({ precioPactado: 50 });

    const p = await svc.previsualizar('neg-1');

    expect(p.precioPactadoUsd).toBe(50);
    expect(p.avisos.join(' ')).toMatch(/precio pactado de \$50/i);
    expect(p.avisos.join(' ')).toMatch(/precio estándar/i);
  });

  it('guarda el precio estándar del anual aparte del monto cobrado', async () => {
    const { svc } = servicio();

    const r = await svc.crear('neg-1', dto({ paidAmountUsd: 350 }), 'admin-1');

    expect(r.standardPriceUsd).toBe(500);
    expect(r.paidAmountUsd).toBe(350);
  });
});

describe('upgrade a anual · Contabilidad', () => {
  it('el ingreso entra como UPGRADE y con la referencia del pago manual', async () => {
    const { svc, aplicado } = servicio();

    await svc.crear('neg-1', dto({ paidAmountUsd: 350 }), 'admin-1');

    const [ing] = aplicado.income;
    expect(ing.category).toBe('UPGRADE');
    expect(ing.grossUsd).toBe(350);
    expect(ing.planPeriodicity).toBe('ANUAL');
    // La referencia TIENE que ser el id del ManualPayment: el conciliador
    // nocturno recorre los pagos manuales y, al que no ve en el libro como
    // `MANUAL|<id>`, le crea un ingreso de categoría RENOVACIÓN. Con otra
    // referencia, este upgrade se contaría dos veces.
    expect(ing.externalTxId).toBe(aplicado.manualPayment.length ? 'mp-1' : null);
  });
});

describe('upgrade a anual · lo que hay que rechazar', () => {
  it('ya es ANUAL: lo dice claro y no cobra nada', async () => {
    const { svc, aplicado } = servicio({ periodicidad: 'ANUAL' });

    await expect(svc.crear('neg-1', dto(), 'admin-1')).rejects.toThrow(/ya está en plan ANUAL/i);
    expect(aplicado.manualPayment).toHaveLength(0);
  });

  it('negocio sin plan asignado', async () => {
    const { svc } = servicio({ plan: { id: 'p0', name: 'Sin plan' } });

    await expect(svc.crear('neg-1', dto(), 'admin-1')).rejects.toThrow(/no tiene un plan asignado/i);
  });

  it('monto en cero o negativo', async () => {
    const { svc } = servicio();

    await expect(svc.crear('neg-1', dto({ paidAmountUsd: 0 }), 'admin-1')).rejects.toThrow(/mayor que cero/i);
    await expect(svc.crear('neg-1', dto({ paidAmountUsd: -5 }), 'admin-1')).rejects.toThrow(/mayor que cero/i);
  });

  it('moneda distinta de USD', async () => {
    const { svc } = servicio();

    await expect(
      svc.crear('neg-1', dto({ currency: 'COP' }), 'admin-1'),
    ).rejects.toThrow(/solo se registra en USD/i);
  });

  it('fecha futura', async () => {
    const { svc } = servicio();

    await expect(
      svc.crear('neg-1', dto({ effectiveAt: new Date(HOY.getTime() + 5 * DIA).toISOString() }), 'admin-1'),
    ).rejects.toThrow(/no puede ser futura/i);
  });

  it('fecha de hace meses: el anual nacería medio consumido', async () => {
    // El año se cuenta DESDE `effectiveAt`. Con una fecha de hace 120 días el
    // negocio arranca con un tercio del plan gastado; con una de hace más de un
    // año, nace vencido y el cron de mora lo suspende esa misma noche.
    const { svc, aplicado } = servicio();

    await expect(
      svc.crear(
        'neg-1',
        dto({ effectiveAt: new Date(HOY.getTime() - 120 * DIA).toISOString() }),
        'admin-1',
      ),
    ).rejects.toThrow(/más de 30 días/i);
    expect(aplicado.manualPayment).toHaveLength(0);
  });

  it('una fecha de hace una semana sí se acepta (el cobro entró y se registra ahora)', async () => {
    const { svc } = servicio();

    const r = await svc.crear(
      'neg-1',
      dto({ effectiveAt: new Date(HOY.getTime() - 7 * DIA).toISOString() }),
      'admin-1',
    );

    expect(r.estado).toBe('COMPLETADO');
  });

  it('negocio suspendido: manda al camino que sí cobra el crédito de la marca', async () => {
    const { svc } = servicio({ status: 'SUSPENDED' });

    await expect(svc.crear('neg-1', dto(), 'admin-1')).rejects.toThrow(/Registrar pago/i);
  });

  it('negocio en prueba: primero se activa', async () => {
    const { svc } = servicio({ status: 'TRIAL' });

    await expect(svc.crear('neg-1', dto(), 'admin-1')).rejects.toThrow(/todavía está en prueba/i);
  });

  it('sin referencia de operación no se cobra', async () => {
    const { svc } = servicio();

    await expect(
      svc.crear('neg-1', dto({ operationRef: '   ' }), 'admin-1'),
    ).rejects.toThrow(/referencia de la operación/i);
  });
});

describe('upgrade a anual · la suscripción vieja hay que cancelarla ANTES', () => {
  it('con suscripción viva y sin confirmar: 400, y no se cobra nada', async () => {
    // Es lo más grave del flujo: 62 de los 67 candidatos tienen suscripción
    // viva. Si sigue cobrando, su próximo cobro le pisa `currentPeriodEnd` con
    // la fecha del ciclo VIEJO (el negocio con el año pagado aparece vencido y
    // el cron de mora lo suspende) y le genera al afiliado otra comisión.
    const { svc, aplicado, upgrades } = servicio({
      hotmartSubscriberCode: 'SUB-REAL-123',
    });

    await expect(
      svc.crear('neg-1', dto({ suscripcionAnteriorCancelada: undefined }), 'admin-1'),
    ).rejects.toThrow(/suscripción viva en la pasarela \(SUB-REAL-123\)/i);

    expect(aplicado.manualPayment).toHaveLength(0);
    expect(aplicado.tenant).toHaveLength(0);
    expect(aplicado.commission).toHaveLength(0);
    // Ni siquiera se abre el acta: no hay nada que anular después.
    expect(upgrades).toHaveLength(0);
  });

  it('un `false` explícito tampoco pasa', async () => {
    const { svc } = servicio();

    await expect(
      svc.crear('neg-1', dto({ suscripcionAnteriorCancelada: false }), 'admin-1'),
    ).rejects.toThrow(/suscripción viva/i);
  });

  it('también con Stripe', async () => {
    const { svc } = servicio({
      hotmartSubscriberCode: null,
      stripeSubscriptionId: 'sub_1234',
    });

    await expect(
      svc.crear('neg-1', dto({ suscripcionAnteriorCancelada: undefined }), 'admin-1'),
    ).rejects.toThrow(/sub_1234/);
  });

  it('confirmándolo: se sella MANUAL_CONFIRMADA con actor y fecha en el mismo acto', async () => {
    const { svc } = servicio({ hotmartSubscriberCode: 'SUB-REAL-123' });

    const r = await svc.crear('neg-1', dto(), 'admin-1');

    expect(r.estado).toBe('COMPLETADO');
    expect(r.cancelacion.estado).toBe('MANUAL_CONFIRMADA');
    expect(r.cancelacion.referencia).toBe('SUB-REAL-123');
    expect(r.cancelacion.quien).toBe('admin-1');
    expect(r.cancelacion.cuando).toEqual(HOY);
  });

  it('un código inventado por el panel (manual-…) NO es una suscripción: no pide confirmación', async () => {
    // Si contara, el upgrade de un negocio creado a mano quedaría bloqueado
    // pidiendo que se cancele algo que no existe en ninguna pasarela.
    const { svc } = servicio({ hotmartSubscriberCode: 'manual-a1b2c3' });

    const r = await svc.crear(
      'neg-1',
      dto({ suscripcionAnteriorCancelada: undefined }),
      'admin-1',
    );

    expect(r.estado).toBe('COMPLETADO');
    expect(r.cancelacion.estado).toBe('NO_APLICA');
    expect(r.cancelacion.referencia).toBeNull();
  });

  it('la previsualización avisa de que va a hacer falta confirmarlo', async () => {
    const { svc } = servicio({ hotmartSubscriberCode: 'SUB-REAL-123' });

    const p = await svc.previsualizar('neg-1');

    expect(p.cancelacionEnPasarela.requiereConfirmacion).toBe(true);
    expect(p.avisos.join(' ')).toMatch(/suscripción viva/i);
  });

  it('el aviso de las 24 h conserva la fecha del PRIMER aviso, no la de hoy', async () => {
    // Antes se reescribía cada día: la columna acababa diciendo siempre «hoy»,
    // y «esto lleva sin cerrar desde el 3» —el único dato útil— se perdía.
    const viejo = {
      id: 'upg-viejo',
      tenantId: 'neg-1',
      estado: 'COMPLETADO',
      metodo: 'MANUAL',
      cancelacionEstado: 'PENDIENTE',
      cancelacionRef: 'SUB-1',
      cancelacionMotivo: null,
      cancelacionAlertaAt: null,
      createdAt: new Date(HOY.getTime() - 3 * DIA),
    };
    const { svc } = servicio({ upgrades: [viejo] });

    const informe = await svc.avisarCancelacionesPendientes();

    expect(informe.vencidas).toBe(1);
    expect(svc.prisma.planUpgrade.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['upg-viejo'] }, cancelacionAlertaAt: null },
      data: { cancelacionAlertaAt: HOY },
    });
    expect(viejo.cancelacionAlertaAt).toEqual(HOY);

    // Al día siguiente vuelve a pasar: la fecha NO se mueve.
    vi.setSystemTime(new Date(HOY.getTime() + DIA));
    await svc.avisarCancelacionesPendientes();
    expect(viejo.cancelacionAlertaAt).toEqual(HOY);
  });

  it('una cancelación reciente (menos de 24 h) todavía no se avisa', async () => {
    const reciente = {
      id: 'upg-hoy',
      tenantId: 'neg-1',
      estado: 'COMPLETADO',
      metodo: 'MANUAL',
      cancelacionEstado: 'PENDIENTE',
      cancelacionRef: 'SUB-1',
      cancelacionAlertaAt: null,
      createdAt: new Date(HOY.getTime() - 2 * 3_600_000),
    };
    const { svc } = servicio({ upgrades: [reciente] });

    const informe = await svc.avisarCancelacionesPendientes();

    expect(informe.vencidas).toBe(0);
    expect(svc.prisma.planUpgrade.updateMany).not.toHaveBeenCalled();
  });

  it('confirmarla a mano (actas viejas) deja quién y cuándo, y es idempotente', async () => {
    const viejo = {
      id: 'upg-viejo',
      tenantId: 'neg-1',
      estado: 'COMPLETADO',
      metodo: 'MANUAL',
      periodicidadOrigen: 'MENSUAL',
      periodicidadDestino: 'ANUAL',
      standardPriceUsd: 500,
      paidAmountUsd: 350,
      currency: 'USD',
      cancelacionEstado: 'PENDIENTE',
      cancelacionRef: 'SUB-1',
      cancelacionAlertaAt: null,
      createdAt: new Date(HOY.getTime() - 3 * DIA),
    };
    const { svc, upgrades } = servicio({ upgrades: [viejo] });

    const r = await svc.confirmarCancelacionManual(
      'neg-1',
      'upg-viejo',
      'admin-2',
      'Cancelada en el panel de Hotmart',
    );
    expect(r.cancelacion.estado).toBe('MANUAL_CONFIRMADA');
    expect(r.cancelacion.quien).toBe('admin-2');
    expect(r.cancelacion.cuando).toEqual(HOY);

    const otra = await svc.confirmarCancelacionManual('neg-1', 'upg-viejo', 'admin-3');
    expect(otra.repetido).toBe(true);
    expect(upgrades[0].cancelacionActorId).toBe('admin-2');
  });
});

describe('upgrade a anual · reparar lo que rompe NUESTRA PROPIA instrucción', () => {
  // Para subir a anual exigimos cancelar antes la suscripción en la pasarela.
  // Ese aviso (`SUBSCRIPTION_CANCELLATION`) deja tres cosas hechas, y dos hay
  // que deshacerlas aquí o el upgrade sale mal en silencio.

  it('limpia `canceledAt`: si no, el cron de cancelados suspende a un negocio con el año pagado', async () => {
    // `BillingService.suspendCanceledAtPeriodEnd` suspende a todo ACTIVE con
    // `canceledAt` en cuanto le vence el período (o si tiene un cobro fallido).
    const { svc, aplicado } = servicio();

    await svc.crear('neg-1', dto(), 'admin-1');

    const [cambio] = aplicado.tenant;
    expect(cambio.canceledAt).toBeNull();
  });

  it('el negocio quedó CHURNED al cancelar: el upgrade le paga igual al afiliado', async () => {
    // `churnReferral` pone en CHURNED TODOS los `ReferralUse` del negocio, y la
    // cadena de atribución solo mira SIGNED_UP/ACTIVE/PAYING. Sin mirar también
    // los CHURNED, este upgrade se completaría con 0 comisiones y HTTP 200
    // justo después de que el administrador hiciera lo que le pedimos.
    const { svc, aplicado, usos } = servicio({
      usos: [{ id: 'use-1', status: 'CHURNED' }],
    });

    const r = await svc.crear('neg-1', dto({ paidAmountUsd: 350 }), 'admin-1');

    expect(r.estado).toBe('COMPLETADO');
    expect(aplicado.commission).toHaveLength(1);
    expect(aplicado.commission[0].amount).toBe(87.5);
    expect(r.comisionOmitidaMotivo).toBeNull();
    // Y la relación vuelve a PAYING: si no, el motor dejaría de generarle las
    // comisiones recurrentes del año que el negocio acaba de pagar.
    expect(usos[0].status).toBe('PAYING');
    expect(aplicado.referralUseUpdate[0]).toMatchObject({
      ids: ['use-1'],
      status: 'PAYING',
    });
  });

  it('si la transacción se cae, los CHURNED se quedan como estaban', async () => {
    const { svc, usos } = servicio({
      usos: [{ id: 'use-1', status: 'CHURNED' }],
      comisionRevienta: true,
    });

    await expect(svc.crear('neg-1', dto(), 'admin-1')).rejects.toThrow();

    expect(usos[0].status).toBe('CHURNED');
  });

  it('completado con 0 comisiones TENIENDO afiliado: sale en la respuesta y en el pendiente', async () => {
    // Éste es el fallo que no se puede repetir: cobrar y que el afiliado se
    // quede sin su comisión sin que nadie se entere. `cadena: null` con un
    // `ReferralUse` existente simula justo eso — hay afiliado pero la cadena no
    // resuelve.
    const { svc, upgrades } = servicio({
      cadena: null,
      usos: [{ id: 'use-1', status: 'PAYING' }],
    });

    const r = await svc.crear('neg-1', dto(), 'admin-1');

    expect(r.estado).toBe('COMPLETADO');
    // La marca lleva PEGADO el motivo de fondo: sin él, el acta dice «mira
    // esto» pero no por dónde empezar.
    expect(r.comisionOmitidaMotivo).toBe(
      'REVISAR:sin-comision-con-afiliado:sin-afiliado',
    );
    expect(r.revisarComision.advertencia).toMatch(/se queda sin cobrar/i);
    expect(svc.logger.warn).toHaveBeenCalled();

    // Y, sobre todo, sale en el endpoint que alguien mira.
    const pendientes = await svc.cancelacionesPendientes();
    expect(pendientes.comisionesARevisar).toHaveLength(1);
    expect(pendientes.comisionesARevisar[0].id).toBe(upgrades[0].id);
    expect(pendientes.comisionesARevisar[0].queHayQueMirar).toMatch(
      /NO generó ninguna comisión/i,
    );
  });

  it('un negocio SIN afiliado se completa en silencio y no ensucia el pendiente', async () => {
    const { svc } = servicio({ cadena: null, usos: [] });

    const r = await svc.crear('neg-1', dto(), 'admin-1');

    expect(r.comisionOmitidaMotivo).toBe('sin-afiliado');
    expect(r.revisarComision).toBeUndefined();
    const pendientes = await svc.cancelacionesPendientes();
    expect(pendientes.comisionesARevisar).toHaveLength(0);
  });

  it('la marca de pago único tampoco ensucia el pendiente: que no haya comisión es la regla', async () => {
    const { svc } = servicio({ marcaPagoUnico: true });

    const r = await svc.crear('neg-1', dto(), 'admin-1');

    expect(r.comisionOmitidaMotivo).toBe('marca-pago-unico');
    expect(r.revisarComision).toBeUndefined();
  });

  it('avisa del correo de cancelación ANTES, que es cuando todavía se puede evitar', async () => {
    const { svc } = servicio({ hotmartSubscriberCode: 'SUB-REAL-123' });

    const p = await svc.previsualizar('neg-1');
    expect(p.avisos.join(' ')).toMatch(/CORREO DE CANCELACIÓN/i);

    // Y también en el 400, que es lo que lee quien lo intenta sin confirmar.
    await expect(
      svc.crear('neg-1', dto({ suscripcionAnteriorCancelada: undefined }), 'admin-1'),
    ).rejects.toThrow(/CORREO DE CANCELACIÓN/i);
  });
});

describe('upgrade a anual · congelar la base de las comisiones que ya estaban', () => {
  // El upgrade cambia la base del negocio ($68 → $500). Las comisiones vivas
  // SIN `baseAmountUsd` se recalculan contra la base ACTUAL, así que una
  // mensual de $15 amanecería en $50 en cuanto alguien tocara un % o pulsara
  // «Corregir todo». En producción 16 de los 29 candidatos no tienen NINGUNA
  // fila con base congelada.

  it('congela la base PRE-upgrade en las vivas que no la tienen', async () => {
    const { svc, aplicado } = servicio({
      baseActual: 68,
      comisionesVivasSinBase: [
        { id: 'com-vieja-1', periodKey: '2028-01' },
        { id: 'com-vieja-2', periodKey: '2028-02' },
      ],
    });

    await svc.crear('neg-1', dto(), 'admin-1');

    expect(aplicado.basesCongeladas).toHaveLength(1);
    expect(aplicado.basesCongeladas[0]).toMatchObject({
      ids: ['com-vieja-1', 'com-vieja-2'],
      baseAmountUsd: 68,
    });
  });

  it('NO cambia ningún importe: solo escribe el número que el motor ya asume hoy', async () => {
    const { svc, aplicado } = servicio({
      baseActual: 68,
      comisionesVivasSinBase: [{ id: 'com-vieja-1', periodKey: '2028-01' }],
    });

    await svc.crear('neg-1', dto(), 'admin-1');

    // Lo único que se escribe en esas filas es `baseAmountUsd`. Ni `amount`,
    // ni el %, ni el estado: congelar no es recalcular.
    const escrito = { ...aplicado.basesCongeladas[0] };
    delete (escrito as any).ids;
    expect(Object.keys(escrito)).toEqual(['baseAmountUsd']);
    // Y la comisión del propio upgrade sigue saliendo del monto pagado.
    expect(aplicado.commission[0].amount).toBe(87.5);
  });

  it('la base congelada es la VIEJA, no la del anual que deja el upgrade', async () => {
    const { svc, aplicado } = servicio({
      periodicidad: 'TRIMESTRAL',
      baseActual: 150,
      comisionesVivasSinBase: [{ id: 'com-vieja-1', periodKey: '2028-01' }],
    });

    await svc.crear('neg-1', dto(), 'admin-1');

    expect(aplicado.basesCongeladas[0].baseAmountUsd).toBe(150);
    expect(aplicado.basesCongeladas[0].baseAmountUsd).not.toBe(500);
    // Se leyó con la periodicidad de ORIGEN, no con ANUAL.
    expect(svc.recalc.getCommissionBase).toHaveBeenCalledWith(null, 'TRIMESTRAL');
  });

  it('no toca las de MONTO LIBRE: su base nunca fue el precio del plan', async () => {
    // Escribirle el precio del plan a una comisión de implementación
    // convertiría una fila que el arqueo hoy deja en paz en una que declara
    // «importe equivocado».
    const { svc, aplicado } = servicio({
      comisionesVivasSinBase: [
        { id: 'com-normal', periodKey: '2028-01' },
        { id: 'com-impl', periodKey: 'IMPL-2028-01-abc' },
        { id: 'com-upg', periodKey: 'UPG-2028-01-xyz' },
      ],
    });

    await svc.crear('neg-1', dto(), 'admin-1');

    expect(aplicado.basesCongeladas[0].ids).toEqual(['com-normal']);
  });

  it('si no hay ninguna sin base, no se escribe nada', async () => {
    const { svc, aplicado } = servicio({ comisionesVivasSinBase: [] });

    await svc.crear('neg-1', dto(), 'admin-1');

    expect(aplicado.basesCongeladas).toHaveLength(0);
  });
});

describe('upgrade a anual · el doble clic no cobra dos veces', () => {
  it('mismo operationRef: devuelve el que ya existe y no toca nada', async () => {
    const { svc, aplicado } = servicio();

    const primero = await svc.crear('neg-1', dto(), 'admin-1');
    const segundo = await svc.crear('neg-1', dto(), 'admin-1');

    expect(segundo.id).toBe(primero.id);
    expect(segundo.repetido).toBe(true);
    expect(aplicado.manualPayment).toHaveLength(1);
    expect(aplicado.commission).toHaveLength(1);
    expect(aplicado.income).toHaveLength(1);
  });

  it('otra referencia sobre un negocio que ya subió: se niega en vez de cobrar otra vez', async () => {
    const { svc, aplicado } = servicio();

    await svc.crear('neg-1', dto(), 'admin-1');
    await expect(
      svc.crear('neg-1', dto({ operationRef: 'op-upgrade-0002' }), 'admin-1'),
    ).rejects.toThrow(/ya tiene un upgrade/i);

    expect(aplicado.manualPayment).toHaveLength(1);
  });
});

describe('upgrade a anual · si algo falla no queda nada a medias', () => {
  it('la comisión revienta: ni cobro, ni periodicidad, ni ingreso — y el acta queda FALLIDO', async () => {
    const { svc, aplicado, upgrades } = servicio({ comisionRevienta: true });

    await expect(svc.crear('neg-1', dto(), 'admin-1')).rejects.toThrow(
      /no quedó nada a medias/i,
    );

    expect(aplicado.manualPayment).toHaveLength(0);
    expect(aplicado.tenant).toHaveLength(0);
    expect(aplicado.income).toHaveLength(0);
    expect(aplicado.commission).toHaveLength(0);
    // El acta sobrevive al rollback (se crea fuera de la transacción) y cuenta
    // qué pasó: sin ella, un upgrade que falló no dejaría rastro.
    expect(upgrades).toHaveLength(1);
    expect(upgrades[0].estado).toBe('FALLIDO');
    expect(upgrades[0].motivoDeFallo).toMatch(/no se pudo crear la comisión/i);
  });

  it('tras el fallo, reintentar con la MISMA referencia vuelve a intentarlo', async () => {
    const { svc, upgrades } = servicio({ comisionRevienta: true });
    await expect(svc.crear('neg-1', dto(), 'admin-1')).rejects.toThrow();

    // Segundo intento: el acta existe en FALLIDO y el negocio no cambió, así
    // que se reintenta sobre la misma fila en vez de bloquearse para siempre.
    const svc2 = servicio({ upgrades });
    const r = await svc2.svc.crear('neg-1', dto(), 'admin-1');

    expect(r.estado).toBe('COMPLETADO');
    expect(upgrades).toHaveLength(1);
  });

  it('si el acta deja de estar pendiente mientras se aplica, no se aplica nada', async () => {
    // Carrera real: alguien anula el acta (o entra otro proceso) entre que la
    // transacción empieza y el sello. El UPDATE condicional devuelve count 0 y
    // la transacción entera se deshace.
    const { svc, aplicado, upgrades } = servicio();
    const original = svc.prisma.$transaction;
    svc.prisma.$transaction = vi.fn(async (fn: any) => {
      // Se anula justo antes de sellar.
      const espia = async (tx: any) => {
        const r = tx.planUpgrade.updateMany;
        tx.planUpgrade.updateMany = async (args: any) => {
          for (const u of upgrades) if (u.id === args.where.id) u.estado = 'CANCELADO';
          return r(args);
        };
        return fn(tx);
      };
      return original(espia);
    });

    await expect(svc.crear('neg-1', dto(), 'admin-1')).rejects.toThrow(
      /dejó de estar pendiente/i,
    );
    expect(aplicado.manualPayment).toHaveLength(0);
    expect(aplicado.tenant).toHaveLength(0);
    // LA ASERCIÓN QUE FALTABA: el acta se queda CANCELADA. El `catch` no la
    // puede pisar con FALLIDO — si lo hiciera, el barrido de la pasarela, que
    // reintenta los FALLIDO cada 30 minutos, acabaría aplicando un upgrade que
    // alguien anuló a propósito.
    expect(upgrades[0].estado).toBe('CANCELADO');
    expect(upgrades[0].motivoDeFallo).toBeUndefined();
  });

  it('el fallo de un acta ANULADA no la resucita: el barrido no puede reintentarla', async () => {
    // Igual que arriba pero visto desde el UPDATE: el WHERE lleva el estado.
    // Con un `update` a secas (lo que había) el CANCELADO pasaba a FALLIDO y el
    // barrido lo recogía media hora después como si nada hubiera pasado.
    const { svc, upgrades } = servicio({ comisionRevienta: true });
    const crearDeVerdad = svc.prisma.planUpgrade.create;
    svc.prisma.planUpgrade.create = vi.fn(async (args: any) => {
      const fila = await crearDeVerdad(args);
      // Entre la reserva del acta y el fallo de la transacción, alguien anula.
      fila.estado = 'CANCELADO';
      return fila;
    });

    await expect(svc.crear('neg-1', dto(), 'admin-1')).rejects.toThrow();

    expect(upgrades[0].estado).toBe('CANCELADO');
    const where = svc.prisma.planUpgrade.updateMany.mock.calls.at(-1)[0].where;
    expect(where.estado).toEqual({ in: ['PENDIENTE', 'FALLIDO'] });
  });
});

describe('upgrade a anual · anular el acta', () => {
  const actaCompletada = () => ({
    id: 'upg-1',
    tenantId: 'neg-1',
    operationRef: 'op-1',
    estado: 'COMPLETADO',
    metodo: 'MANUAL',
    periodicidadOrigen: 'MENSUAL',
    periodicidadDestino: 'ANUAL',
    standardPriceUsd: 500,
    paidAmountUsd: 350,
    currency: 'USD',
    effectiveAt: HOY,
    nextRenewalAt: new Date('2029-02-28T12:00:00.000Z'),
    manualPaymentId: 'mp-1',
    incomeRecordId: 'inc-1',
    commissionId: 'com-1',
    commissionAmount: 87.5,
    comisionesCreadas: 1,
    precioPactadoAnterior: 50,
    cancelacionEstado: 'MANUAL_CONFIRMADA',
    createdAt: HOY,
  });

  it('un PENDIENTE colgado se puede cerrar: era lo que bloqueaba para siempre', async () => {
    // Si el proceso muere entre la reserva del acta y la transacción, queda un
    // PENDIENTE que el único parcial convierte en un candado eterno.
    const colgado = {
      ...actaCompletada(),
      estado: 'PENDIENTE',
      manualPaymentId: null,
      incomeRecordId: null,
      commissionId: null,
      comisionesCreadas: 0,
    };
    const { svc, upgrades } = servicio({ upgrades: [colgado] });

    const r = await svc.anular('neg-1', 'upg-1', 'admin-9', 'Se quedó colgado el 12');

    expect(r.estado).toBe('CANCELADO');
    expect(upgrades[0].estadoAlAnular).toBe('PENDIENTE');
    // No llegó a aplicar nada: no hay nada que arreglar a mano.
    expect(r.quedaPorArreglarAMano).toEqual([]);
    // Y ahora se puede volver a subir el negocio.
    const nuevo = await svc.crear('neg-1', dto({ operationRef: 'op-nueva-0002' }), 'admin-1');
    expect(nuevo.estado).toBe('COMPLETADO');
  });

  it('desde COMPLETADO también, pero NO revierte el plan, ni el pago, ni la comisión', async () => {
    const { svc, aplicado } = servicio({ upgrades: [actaCompletada()] });

    const r = await svc.anular(
      'neg-1',
      'upg-1',
      'admin-9',
      'Se le aplicó al negocio equivocado',
    );

    expect(r.estado).toBe('CANCELADO');
    expect(r.advertencia).toMatch(/NO revierte el plan/i);
    expect(r.advertencia).toMatch(/NO devuelve el cobro/i);
    expect(r.advertencia).toMatch(/NO anula la comisión/i);
    // Y no toca nada en el negocio.
    expect(aplicado.tenant).toHaveLength(0);
    // Lo que queda por arreglar a mano se dice, no se adivina.
    const texto = r.quedaPorArreglarAMano.join(' ');
    expect(texto).toMatch(/SIGUE en plan ANUAL/i);
    expect(texto).toMatch(/mp-1/);
    expect(texto).toMatch(/inc-1/);
    expect(texto).toMatch(/comisión/i);
    expect(texto).toMatch(/precio pactado de \$50/i);
  });

  it('queda en la auditoría qué había que arreglar a mano', async () => {
    const { svc } = servicio({ upgrades: [actaCompletada()] });

    await svc.anular('neg-1', 'upg-1', 'admin-9', 'Monto equivocado');

    const llamada = svc.audit.log.mock.calls.at(-1)[0];
    expect(llamada.action).toBe('tenant.plan_upgrade_anulado');
    expect(llamada.metadata.motivo).toBe('Monto equivocado');
    expect(llamada.metadata.estadoAlAnular).toBe('COMPLETADO');
    expect(llamada.metadata.manualPaymentId).toBe('mp-1');
    expect(llamada.metadata.quedaPorArreglarAMano.length).toBeGreaterThan(0);
  });

  it('sin motivo no se anula', async () => {
    const { svc, upgrades } = servicio({ upgrades: [actaCompletada()] });

    await expect(svc.anular('neg-1', 'upg-1', 'admin-9', '  ')).rejects.toThrow(
      /exige un motivo/i,
    );
    expect(upgrades[0].estado).toBe('COMPLETADO');
  });

  it('anularlo dos veces no reescribe quién lo anuló', async () => {
    const { svc, upgrades } = servicio({ upgrades: [actaCompletada()] });

    await svc.anular('neg-1', 'upg-1', 'admin-9', 'Primera razón');
    const otra = await svc.anular('neg-1', 'upg-1', 'admin-8', 'Segunda razón');

    expect(otra.repetido).toBe(true);
    expect(upgrades[0].anuladoActorId).toBe('admin-9');
    expect(upgrades[0].anuladoMotivo).toBe('Primera razón');
  });

  it('si otro lo anula a la vez, el segundo no le reescribe el motivo', async () => {
    // El `if (estado === CANCELADO)` de arriba no basta: entre leer el acta y
    // escribirla puede colarse otra anulación. Por eso el UPDATE lleva el
    // estado en el WHERE y se mira el `count`.
    const { svc, upgrades } = servicio({ upgrades: [actaCompletada()] });
    const leerDeVerdad = svc.prisma.planUpgrade.findFirst;
    svc.prisma.planUpgrade.findFirst = vi.fn(async (args: any) => {
      const fila = await leerDeVerdad(args);
      const foto = fila ? { ...fila } : null; // la foto que ya tenemos en mano
      // …y justo aquí, otro proceso la anula.
      Object.assign(upgrades[0], {
        estado: 'CANCELADO',
        estadoAlAnular: 'COMPLETADO',
        anuladoActorId: 'admin-otro',
        anuladoMotivo: 'Lo anulé yo primero',
      });
      return foto;
    });

    const r = await svc.anular('neg-1', 'upg-1', 'admin-9', 'Llego tarde');

    expect(r.repetido).toBe(true);
    expect(upgrades[0].anuladoActorId).toBe('admin-otro');
    expect(upgrades[0].anuladoMotivo).toBe('Lo anulé yo primero');
  });

  it('un upgrade de otro negocio no se puede anular desde aquí', async () => {
    const ajeno = { ...actaCompletada(), tenantId: 'otro-negocio' };
    const { svc } = servicio({ upgrades: [ajeno] });

    await expect(
      svc.anular('neg-1', 'upg-1', 'admin-9', 'Me equivoqué de pantalla'),
    ).rejects.toThrow(/no encontrado/i);
  });
});

describe('upgrade a anual · el guardián del cobro viejo', () => {
  const actaViva = (extra: any = {}) => ({
    id: 'upg-1',
    tenantId: 'neg-1',
    operationRef: 'op-1',
    estado: 'COMPLETADO',
    metodo: 'MANUAL',
    periodicidadOrigen: 'MENSUAL',
    periodicidadDestino: 'ANUAL',
    standardPriceUsd: 500,
    paidAmountUsd: 350,
    currency: 'USD',
    effectiveAt: new Date(HOY.getTime() - 10 * DIA),
    nextRenewalAt: new Date('2029-02-19T12:00:00.000Z'),
    cancelacionEstado: 'MANUAL_CONFIRMADA',
    cancelacionRef: 'SUB-REAL-123',
    cobroViejoDetectadoAt: null,
    cobroViejoVeces: 0,
    createdAt: new Date(HOY.getTime() - 10 * DIA),
    ...extra,
  });

  it('entró el cobro del ciclo viejo: restaura la renovación del año pagado', async () => {
    // El síntoma: `currentPeriodEnd` por debajo de `nextRenewalAt`. El negocio
    // tiene el año pagado y sin embargo aparece vencido; el cron de mora lo
    // suspendería.
    const acta = actaViva();
    const { svc, negocio, upgrades } = servicio({
      upgrades: [acta],
      // Ya está en anual (lo dejó el upgrade)…
      periodicidad: 'ANUAL',
      // …pero Hotmart le escribió la fecha del ciclo MENSUAL.
      currentPeriodEnd: new Date('2028-03-20T12:00:00.000Z'),
    });

    const informe = await svc.vigilarCobrosViejos();

    expect(informe.restaurados).toHaveLength(1);
    expect(negocio.currentPeriodEnd).toEqual(acta.nextRenewalAt);
    // Y se limpian los dedup de aviso: si no, el negocio no recibiría ningún
    // recordatorio del ciclo bueno.
    expect(negocio.preReminder7dSentFor).toBeNull();
    expect(negocio.paymentReminderSentFor).toBeNull();
    // Queda escrito en el acta, no solo en el log.
    expect(upgrades[0].cobroViejoDetectadoAt).toEqual(HOY);
    expect(upgrades[0].cobroViejoVeces).toBe(1);
    expect(upgrades[0].cobroViejoPeriodEnd.toISOString().slice(0, 10)).toBe(
      '2028-03-20',
    );
  });

  it('restaura con un UPDATE CONDICIONAL: si ya lo arreglaron, no pisa nada', async () => {
    const { svc, upgrades } = servicio({
      upgrades: [actaViva()],
      periodicidad: 'ANUAL',
      currentPeriodEnd: new Date('2028-03-20T12:00:00.000Z'),
      restauracionSinEfecto: true,
    });

    const informe = await svc.vigilarCobrosViejos();

    expect(svc.prisma.tenant.updateMany).toHaveBeenCalled();
    const where = svc.prisma.tenant.updateMany.mock.calls[0][0].where;
    // La comparación se repite en el WHERE: es lo que convierte
    // leer-decidir-escribir en una operación atómica.
    expect(where.currentPeriodEnd.lt).toEqual(upgrades[0].nextRenewalAt);
    expect(informe.restaurados).toHaveLength(0);
    expect(upgrades[0].cobroViejoDetectadoAt).toBeNull();
  });

  it('la comisión que generó el cobro viejo NO se toca: se deja señalada', async () => {
    const posterior = {
      id: 'com-del-cobro-viejo',
      amount: 17,
      periodKey: '2028-03',
      createdAt: HOY,
    };
    const { svc, upgrades } = servicio({
      upgrades: [actaViva()],
      periodicidad: 'ANUAL',
      currentPeriodEnd: new Date('2028-03-20T12:00:00.000Z'),
      comisionesPosteriores: [posterior],
    });

    const informe = await svc.vigilarCobrosViejos();

    expect(informe.restaurados[0].comisionesParaRevisar).toEqual([
      'com-del-cobro-viejo',
    ]);
    expect(upgrades[0].cobroViejoComisiones).toBe('com-del-cobro-viejo');
    // Sale en el endpoint de pendientes, que es donde alguien la va a ver.
    const pendientes = await svc.cancelacionesPendientes();
    expect(pendientes.cobrosViejos[0].comisionesParaRevisar).toEqual([
      'com-del-cobro-viejo',
    ]);
  });

  it('busca las comisiones posteriores sin dejar fuera las de periodKey nulo', async () => {
    const { svc } = servicio({
      upgrades: [actaViva()],
      periodicidad: 'ANUAL',
      currentPeriodEnd: new Date('2028-03-20T12:00:00.000Z'),
    });

    await svc.vigilarCobrosViejos();

    const where = svc.prisma.commission.findMany.mock.calls[0][0].where;
    // Un `NOT { externalTxId: 'upgrade:…' }` a secas dejaría fuera las filas
    // con `externalTxId` NULL, que en SQL no son «distintas de».
    expect(where.OR).toEqual([
      { externalTxId: null },
      { NOT: { externalTxId: { in: ['upgrade:upg-1'] } } },
    ]);
  });

  it('la comisión del upgrade POR PASARELA no se lista como sospechosa', async () => {
    // Cuando el upgrade se cobró por pasarela, la comisión buena lleva el
    // `externalTxId` DE LA PASARELA (la creó el webhook y el upgrade se la
    // corrigió), no `upgrade:<id>`. Sin excluir también ese id, el guardián
    // mandaba a revisar a mano, todas las noches, la comisión correcta.
    const laDelUpgrade = {
      id: 'com-del-upgrade',
      amount: 87.5,
      periodKey: 'UPG-2028-02-upg-1',
      createdAt: HOY,
    };
    const { svc } = servicio({
      upgrades: [actaViva({ metodo: 'PASARELA', gatewayTxId: 'HP-ANUAL-1' })],
      periodicidad: 'ANUAL',
      currentPeriodEnd: new Date('2028-03-20T12:00:00.000Z'),
      comisionesPosteriores: [laDelUpgrade],
    });

    const informe = await svc.vigilarCobrosViejos();

    const where = svc.prisma.commission.findMany.mock.calls[0][0].where;
    expect(where.OR[1].NOT.externalTxId.in).toEqual([
      'upgrade:upg-1',
      'HP-ANUAL-1',
    ]);
    // (El mock devuelve la fila igual — lo que se comprueba es el FILTRO, que
    // es lo que en producción la deja fuera.)
    expect(informe.restaurados).toHaveLength(1);
  });

  it('si a alguien le bajaron el plan a mano, el guardián no se pelea con esa decisión', async () => {
    // El negocio ya no está en anual: la fecha del acta dejó de mandar.
    // Restaurarla cada noche sería deshacer la decisión de una persona.
    const { svc } = servicio({
      upgrades: [actaViva()],
      periodicidad: 'MENSUAL',
      currentPeriodEnd: new Date('2028-03-20T12:00:00.000Z'),
    });

    const informe = await svc.vigilarCobrosViejos();

    expect(informe.restaurados).toHaveLength(0);
    expect(svc.prisma.tenant.updateMany).not.toHaveBeenCalled();
  });

  it('un negocio al día no se toca', async () => {
    const { svc } = servicio({
      upgrades: [actaViva()],
      periodicidad: 'ANUAL',
      currentPeriodEnd: new Date('2029-02-19T12:00:00.000Z'),
    });

    const informe = await svc.vigilarCobrosViejos();

    expect(informe.restaurados).toHaveLength(0);
    expect(svc.prisma.tenant.updateMany).not.toHaveBeenCalled();
  });

  it('a la segunda vez conserva la fecha de la PRIMERA detección', async () => {
    const acta = actaViva();
    const { svc, upgrades } = servicio({
      upgrades: [acta],
      periodicidad: 'ANUAL',
      currentPeriodEnd: new Date('2028-03-20T12:00:00.000Z'),
    });

    await svc.vigilarCobrosViejos();
    const primera = upgrades[0].cobroViejoDetectadoAt;

    // Un mes después vuelve a entrar otro cobro viejo.
    vi.setSystemTime(new Date(HOY.getTime() + 30 * DIA));
    svc.prisma.tenant.findUnique = vi.fn(async () => ({
      id: 'neg-1',
      brandName: 'Birria León',
      status: 'ACTIVE',
      deletedAt: null,
      planPeriodicity: 'ANUAL',
      currentPeriodEnd: new Date('2028-04-20T12:00:00.000Z'),
    }));
    await svc.vigilarCobrosViejos();

    expect(upgrades[0].cobroViejoDetectadoAt).toEqual(primera);
    expect(upgrades[0].cobroViejoVeces).toBe(2);
    expect(upgrades[0].cobroViejoUltimoAt).not.toEqual(primera);
  });
});

describe('el interruptor del cobro por pasarela', () => {
  // Se suelta primero el camino MANUAL (Javier, 2026-09-21). El de pasarela
  // está entero y probado con dobles, pero nunca se ha ejecutado contra un
  // cobro real y corrige filas que crea el webhook: se estrena a mano.
  it('sin el interruptor, crear por pasarela se rechaza diciendo qué hacer', async () => {
    delete process.env.UPGRADE_POR_PASARELA;
    const { svc } = servicio({ whiteLabelId: 'wl-1' });
    await expect(
      svc.crear('neg-1', { operationRef: 'ref-x', paidAmountUsd: 350, metodo: 'PASARELA', suscripcionAnteriorCancelada: true } as any, 'admin-1'),
    ).rejects.toThrow(/manual/i);
  });

  it('sin el interruptor, el barrido no toca nada', async () => {
    delete process.env.UPGRADE_POR_PASARELA;
    const { svc } = servicio({ whiteLabelId: 'wl-1' });
    const r = await svc.completarUpgradesPorPasarela();
    expect(r).toMatchObject({ apagado: true, completados: [] });
  });

  it('con el interruptor puesto, el camino se abre', async () => {
    process.env.UPGRADE_POR_PASARELA = '1';
    const { svc } = servicio({ whiteLabelId: 'wl-1' });
    const r = await svc.crear(
      'neg-1',
      { operationRef: 'ref-y', paidAmountUsd: 350, metodo: 'PASARELA', suscripcionAnteriorCancelada: true } as any,
      'admin-1',
    );
    expect(r.estado).toBe('PENDIENTE');
  });
});

describe('upgrade a anual · el cobro POR PASARELA', () => {
  // Este bloque prueba el camino por pasarela ENTERO, así que se abre el
  // interruptor: lo que se prueba es la lógica, no el interruptor (que tiene
  // su propio bloque arriba).
  beforeEach(() => {
    process.env.UPGRADE_POR_PASARELA = '1';
  });
  afterEach(() => {
    delete process.env.UPGRADE_POR_PASARELA;
  });
  // El aviso ya REPOSÓ: el barrido exige 5 minutos para no adelantarse al
  // webhook, que guarda el aviso antes de crear su comisión.
  const REPOSADO = new Date(HOY.getTime() - 10 * 60_000);
  const eventoHotmart = (extra: any = {}) => ({
    eventType: 'PURCHASE_APPROVED',
    tenantId: 'neg-1',
    processedAt: REPOSADO,
    payload: {
      data: {
        purchase: {
          transaction: 'HP-ANUAL-1',
          approved_date: HOY.getTime(),
          price: { value: 480, currency_value: 'USD' },
          ...(extra.purchase ?? {}),
        },
        subscription: {
          subscriber: { code: 'SUB-REAL-123' },
          plan: { name: extra.plan ?? 'Clubify Anual' },
        },
        buyer: { email: 'hola@birrialeon.test' },
      },
    },
  });

  it('crear con método PASARELA: acta PENDIENTE, y NO mueve nada', async () => {
    const { svc, aplicado, upgrades } = servicio({ whiteLabelId: 'wl-1' });

    const r = await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    expect(r.estado).toBe('PENDIENTE');
    expect(aplicado.tenant).toHaveLength(0);
    expect(aplicado.manualPayment).toHaveLength(0);
    expect(aplicado.income).toHaveLength(0);
    expect(aplicado.commission).toHaveLength(0);
    expect(upgrades[0].metodo).toBe('PASARELA');
  });

  it('devuelve el enlace del plan ANUAL de la marca para mandárselo al cliente', async () => {
    const { svc } = servicio({ whiteLabelId: 'wl-1' });

    const r = await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    expect(r.enlaceDePago.url).toBe('https://pay.example/anual');
    expect(r.enlaceDePago.montoUsd).toBe(500);
    const filtro = svc.prisma.whiteLabelPaymentLink.findFirst.mock.calls[0][0].where;
    expect(filtro).toMatchObject({ whiteLabelId: 'wl-1', periodicity: 'ANUAL', active: true });
  });

  it('sin enlace anual configurado lo dice en vez de callarse', async () => {
    const { svc } = servicio({ whiteLabelId: 'wl-1', enlaceAnual: null });

    const r = await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    expect(r.enlaceDePago).toBeNull();
    expect(r.aviso).toMatch(/no tiene\s+enlace de pago del plan ANUAL|cóbralo por fuera/i);
  });

  it('cuando entra el pago anual, el barrido lo completa por el mismo camino', async () => {
    const { svc, aplicado, upgrades } = servicio({
      whiteLabelId: 'wl-1',
      eventosHotmart: [eventoHotmart()],
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    const informe = await svc.completarUpgradesPorPasarela();

    expect(informe.completados).toHaveLength(1);
    expect(upgrades[0].estado).toBe('COMPLETADO');
    // El negocio pasa a ANUAL…
    expect(aplicado.tenant[0].planPeriodicity).toBe('ANUAL');
    // …el monto es el REALMENTE cobrado que trae el aviso, no el esperado…
    // Manda el monto DEL ACTA, no el que traiga el aviso (Javier, 2026-09-21):
    // lo que se comisiona es lo que se pactó con el cliente.
    expect(upgrades[0].paidAmountUsd).toBe(350);
    expect(Number(aplicado.commission[0].baseAmountUsd)).toBe(350);
    expect(aplicado.commission[0].amount).toBe(87.5); // 25 % de 350
    // …y NO se crea un ManualPayment: ese dinero no entró «por fuera».
    expect(aplicado.manualPayment).toHaveLength(0);
    // El ingreso queda con la transacción de la pasarela como referencia.
    expect(aplicado.income[0].externalTxId).toBe('HP-ANUAL-1');
    expect(aplicado.income[0].category).toBe('UPGRADE');
    expect(upgrades[0].gatewayTxId).toBe('HP-ANUAL-1');
  });

  it('el MISMO aviso no completa dos veces', async () => {
    const { svc, aplicado } = servicio({
      whiteLabelId: 'wl-1',
      eventosHotmart: [eventoHotmart(), eventoHotmart()],
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    await svc.completarUpgradesPorPasarela();
    // El barrido vuelve a correr media hora después con el aviso todavía ahí.
    const segunda = await svc.completarUpgradesPorPasarela();

    expect(segunda.revisados).toBe(0); // el acta ya no está PENDIENTE
    expect(aplicado.tenant).toHaveLength(1);
    expect(aplicado.income).toHaveLength(1);
    expect(aplicado.commission).toHaveLength(1);
  });

  it('el cobro del ciclo VIEJO no completa el upgrade', async () => {
    // El negocio puede tener todavía viva la mensual: su renovación entra por
    // aquí igual de «suya» y «posterior». Completar con ella sería pasarlo a
    // anual por $17.
    const { svc, aplicado, upgrades } = servicio({
      whiteLabelId: 'wl-1',
      eventosHotmart: [
        eventoHotmart({
          plan: 'Clubify Mensual',
          purchase: { transaction: 'HP-MENSUAL-9', price: { value: 17, currency_value: 'USD' } },
        }),
      ],
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    const informe = await svc.completarUpgradesPorPasarela();

    expect(informe.completados).toHaveLength(0);
    expect(upgrades[0].estado).toBe('PENDIENTE');
    expect(aplicado.tenant).toHaveLength(0);
    expect(informe.esperando[0].nota).toMatch(/NO es del plan anual/i);
  });

  it('un aviso REAL en COP se completa con `original_offer_price` (era lo que atascaba el barrido)', async () => {
    // Payload copiado de producción: «Plan Anual», oferta f4weer6x «500 USD»,
    // cobrado en Colombia. `price` y `full_price` vienen en COP —157 de 213
    // compras de 90 días llegan en moneda local, y los 6 avisos de Plan Anual
    // fueron COP— así que con solo esos dos campos el barrido NO completaba
    // NUNCA por esta vía. `original_offer_price` sí viene en USD: en 213 de
    // 213 eventos.
    const { svc, aplicado, upgrades } = servicio({
      whiteLabelId: 'wl-1',
      eventosHotmart: [
        {
          eventType: 'PURCHASE_COMPLETE',
          tenantId: 'neg-1',
          processedAt: REPOSADO,
          payload: {
            data: {
              purchase: {
                offer: { code: 'f4weer6x', description: '500 USD' },
                price: { value: 1800745.68, currency_value: 'COP' },
                status: 'COMPLETED',
                payment: { type: 'CREDIT_CARD', installments_number: 1 },
                full_price: { value: 1818384, currency_value: 'COP' },
                transaction: 'HP4010214013',
                approved_date: HOY.getTime(),
                checkout_country: { iso: 'CO', name: 'Colombia' },
                recurrence_number: 1,
                original_offer_price: { value: 522.38, currency_value: 'USD' },
              },
              subscription: {
                subscriber: { code: 'SUB-REAL-123' },
                plan: { name: 'Plan Anual' },
              },
              buyer: { email: 'hola@birrialeon.test' },
            },
          },
        },
      ],
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    const informe = await svc.completarUpgradesPorPasarela();

    expect(informe.completados).toHaveLength(1);
    expect(upgrades[0].estado).toBe('COMPLETADO');
    // MANDA EL ACTA: Hotmart dijo 522,38 (su conversión de los pesos), pero se
    // comisiona sobre lo que el administrador pactó y registró. La cifra de la
    // pasarela queda anotada como referencia (Javier, 2026-09-21).
    expect(upgrades[0].paidAmountUsd).toBe(350);
    expect(aplicado.income[0].grossUsd).toBe(350);
    expect(upgrades[0].barridoNota).toMatch(/522\.38/);
    expect(upgrades[0].barridoNota).toMatch(/ACTA/i);
  });

  it('sin ningún importe en USD, el monto sale del ACTA — y NO se manda a completarlo como MANUAL', async () => {
    // Completarlo como MANUAL crearía un `ManualPayment` y otra comisión
    // ADEMÁS de las que la pasarela ya generó por este mismo cobro: el
    // consejo que había aquí duplicaba el dinero.
    const { svc, upgrades } = servicio({
      whiteLabelId: 'wl-1',
      eventosHotmart: [
        eventoHotmart({
          purchase: {
            price: { value: 1_900_000, currency_value: 'COP' },
            full_price: { value: 1_950_000, currency_value: 'COP' },
            original_offer_price: { value: 1_900_000, currency_value: 'COP' },
          },
        }),
      ],
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA', paidAmountUsd: 350 }), 'admin-1');

    const informe = await svc.completarUpgradesPorPasarela();

    expect(informe.completados).toHaveLength(1);
    expect(upgrades[0].paidAmountUsd).toBe(350);
    expect(upgrades[0].barridoNota).toMatch(/EL ACTA/);
    expect(upgrades[0].barridoNota).not.toMatch(/MANUAL con el monto real/i);
  });

  it('el aviso recién llegado NO completa: se espera a que el webhook cree su comisión', async () => {
    // El webhook GUARDA el aviso al principio (es su candado contra el doble
    // proceso) y crea la comisión varios pasos después. Si el barrido cae en
    // medio no ve ninguna comisión de esa transacción, crea la suya, y el
    // webhook crea otra: el afiliado cobra dos veces por un solo cobro.
    const { svc, aplicado, upgrades } = servicio({
      whiteLabelId: 'wl-1',
      eventosHotmart: [{ ...eventoHotmart(), processedAt: new Date(HOY.getTime() - 60_000) }],
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    const informe = await svc.completarUpgradesPorPasarela();

    expect(informe.completados).toHaveLength(0);
    expect(upgrades[0].estado).toBe('PENDIENTE');
    expect(aplicado.commission).toHaveLength(0);
    expect(informe.esperando[0].nota).toMatch(/menos de 5 minutos/i);

    // Seis minutos después, el mismo aviso sí se completa.
    vi.setSystemTime(new Date(HOY.getTime() + 6 * 60_000));
    const segunda = await svc.completarUpgradesPorPasarela();
    expect(segunda.completados).toHaveLength(1);
  });

  it('sin pago, el acta se queda PENDIENTE y dice por qué', async () => {
    const { svc, aplicado, upgrades } = servicio({ whiteLabelId: 'wl-1' });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    const informe = await svc.completarUpgradesPorPasarela();

    expect(upgrades[0].estado).toBe('PENDIENTE');
    expect(aplicado.tenant).toHaveLength(0);
    expect(aplicado.commission).toHaveLength(0);
    expect(informe.esperando[0].nota).toMatch(/todavía no ha llegado/i);
    // Y sale en la pantalla del pendiente.
    const pendientes = await svc.cancelacionesPendientes();
    expect(pendientes.porPasarela).toHaveLength(1);
    expect(pendientes.porPasarela[0].barridoNota).toMatch(/todavía no ha llegado/i);
  });

  it('si la pasarela ya registró el ingreso, se enlaza y NO se duplica', async () => {
    const { svc, aplicado, upgrades } = servicio({
      whiteLabelId: 'wl-1',
      eventosHotmart: [eventoHotmart()],
      ingresoYaExiste: true,
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    await svc.completarUpgradesPorPasarela();

    expect(aplicado.income).toHaveLength(0);
    expect(upgrades[0].incomeRecordId).toBe('inc-de-la-pasarela');
    expect(upgrades[0].barridoNota).toMatch(/ya estaba en Contabilidad/i);
  });

  it('si la pasarela ya creó la comisión de ese cobro, no se le paga dos veces al afiliado', async () => {
    const { svc, aplicado, upgrades } = servicio({
      whiteLabelId: 'wl-1',
      eventosHotmart: [eventoHotmart()],
      comisionesDeLaPasarela: [
        {
          id: 'com-de-hotmart',
          amount: 13.5,
          status: 'PENDING',
          recipientCodeId: 'inf',
          referralUseId: 'use-1',
        },
      ],
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    await svc.completarUpgradesPorPasarela();

    // No se crea NINGUNA comisión nueva: sería pagarle dos veces por un cobro.
    expect(aplicado.commission).toHaveLength(0);
    expect(upgrades[0].commissionId).toBe('com-de-hotmart');
  });

  it('la comisión que creó la pasarela se CORRIGE: el afiliado cobraba de menos', async () => {
    // El webhook la calculó con la periodicidad VIEJA (los $68 del mensual →
    // $13,50 al 20 %) cuando el negocio pagó el anual. Enlazarla sin
    // tocarla deja al afiliado cobrando $13,50 donde le tocaban $87,50, y el
    // aviso vivía en un campo que no sale en ningún listado.
    const { svc, aplicado, upgrades } = servicio({
      whiteLabelId: 'wl-1',
      eventosHotmart: [eventoHotmart()],
      comisionesDeLaPasarela: [
        {
          id: 'com-de-hotmart',
          amount: 13.5,
          status: 'PENDING',
          recipientCodeId: 'inf',
          referralUseId: 'use-1',
        },
      ],
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    await svc.completarUpgradesPorPasarela();

    expect(aplicado.commissionUpdate).toHaveLength(1);
    const c = aplicado.commissionUpdate[0];
    expect(c.id).toBe('com-de-hotmart');
    expect(c.amount).toBe(87.5); // 25 % de los 350 del acta
    expect(c.baseAmountUsd).toBe(350);
    expect(c.appliedPercent).toBe(25);
    // periodKey del upgrade: además de explicar de qué es, la saca del
    // recálculo por base del negocio, que la devolvería a los $500 del anual.
    expect(c.periodKey).toBe(`UPG-2028-02-${upgrades[0].id}`);
    expect(c.notes).toMatch(/Corregida por el upgrade/i);
    // El acta cuenta el importe BUENO, no el viejo.
    expect(upgrades[0].commissionAmount).toBe(87.5);
    expect(upgrades[0].barridoNota).toMatch(/\$13\.50 → \$87\.5/);
  });

  it('y el ingreso de la pasarela también: era una RENOVACIÓN por el precio del plan viejo', async () => {
    const { svc, aplicado, upgrades } = servicio({
      whiteLabelId: 'wl-1',
      eventosHotmart: [eventoHotmart()],
      ingresoYaExiste: {
        id: 'inc-de-la-pasarela',
        grossUsd: 68,
        category: 'RENOVACION',
        planPeriodicity: null,
      },
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    await svc.completarUpgradesPorPasarela();

    // No se duplica (sumaría el mismo dinero dos veces): se corrige el que hay.
    expect(aplicado.income).toHaveLength(0);
    expect(aplicado.incomeUpdate).toHaveLength(1);
    expect(aplicado.incomeUpdate[0]).toMatchObject({
      id: 'inc-de-la-pasarela',
      category: 'UPGRADE',
      planPeriodicity: 'ANUAL',
      grossUsd: 350,
    });
    expect(upgrades[0].incomeRecordId).toBe('inc-de-la-pasarela');
    expect(upgrades[0].barridoNota).toMatch(/se CORRIGIÓ/);
  });

  it('una comisión YA PAGADA no se toca: sale como «comisión a revisar»', async () => {
    // Lo pagado no se retracta (regla de Javier y Sara). Pero se le pagó de
    // menos: eso es dinero que alguien tiene que mirar, no un campo mudo.
    const { svc, aplicado, upgrades } = servicio({
      whiteLabelId: 'wl-1',
      eventosHotmart: [eventoHotmart()],
      comisionesDeLaPasarela: [
        {
          id: 'com-ya-pagada',
          amount: 13.5,
          status: 'PAID',
          recipientCodeId: 'inf',
          referralUseId: 'use-1',
        },
      ],
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    await svc.completarUpgradesPorPasarela();

    expect(aplicado.commissionUpdate).toHaveLength(0);
    expect(aplicado.commission).toHaveLength(0);
    expect(upgrades[0].comisionOmitidaMotivo).toBe(
      'REVISAR:comision-de-pasarela-ya-pagada',
    );
    expect(upgrades[0].barridoNota).toMatch(/REVISAR A MANO/i);

    const pendientes = await svc.cancelacionesPendientes();
    expect(pendientes.comisionesARevisar).toHaveLength(1);
    expect(pendientes.comisionesARevisar[0].commissionId).toBe('com-ya-pagada');
    expect(pendientes.comisionesARevisar[0].queHayQueMirar).toMatch(
      /pagó de menos/i,
    );
  });

  it('un beneficiario fuera de la cadena actual no se corrige a ciegas', async () => {
    // Si al negocio le reasignaron el afiliado entre el cobro y el barrido, el
    // importe bueno para ESE beneficiario no se puede deducir: se deja y se
    // manda a revisar en vez de inventarle un número.
    const { svc, aplicado, upgrades } = servicio({
      whiteLabelId: 'wl-1',
      eventosHotmart: [eventoHotmart()],
      comisionesDeLaPasarela: [
        {
          id: 'com-de-otro',
          amount: 13.5,
          status: 'PENDING',
          recipientCodeId: 'afiliado-que-ya-no-esta',
          referralUseId: 'use-viejo',
        },
      ],
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    await svc.completarUpgradesPorPasarela();

    expect(aplicado.commissionUpdate).toHaveLength(0);
    expect(upgrades[0].comisionOmitidaMotivo).toBe(
      'REVISAR:comision-de-pasarela-ya-pagada',
    );
  });

  it('el año se cuenta desde que el cliente PAGÓ, no desde que se abrió el acta', async () => {
    const pago = new Date(HOY.getTime() + 20 * DIA);
    const { svc, upgrades } = servicio({
      whiteLabelId: 'wl-1',
      eventosHotmart: [
        {
          ...eventoHotmart(),
          processedAt: pago,
          payload: {
            data: {
              purchase: {
                transaction: 'HP-ANUAL-1',
                approved_date: pago.getTime(),
                price: { value: 500, currency_value: 'USD' },
              },
              subscription: {
                subscriber: { code: 'SUB-REAL-123' },
                plan: { name: 'Anual' },
              },
              buyer: { email: 'hola@birrialeon.test' },
            },
          },
        },
      ],
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    // +10 min: el aviso tiene que haber reposado para que el barrido lo tome.
    vi.setSystemTime(new Date(pago.getTime() + 10 * 60_000));
    await svc.completarUpgradesPorPasarela();

    expect(upgrades[0].effectiveAt).toEqual(pago);
    expect(upgrades[0].nextRenewalAt.toISOString().slice(0, 10)).toBe('2029-03-20');
  });

  it('Stripe: completa con una factura de precio ANUAL', async () => {
    const { svc, aplicado, upgrades } = servicio({
      whiteLabelId: 'wl-1',
      hotmartSubscriberCode: null,
      stripeSubscriptionId: 'sub_viejo',
      eventosStripe: [
        {
          tenantId: 'neg-1',
          processedAt: REPOSADO,
          payload: {
            data: {
              object: {
                id: 'in_ANUAL_1',
                currency: 'usd',
                amount_paid: 45_000,
                status_transitions: { paid_at: Math.floor(HOY.getTime() / 1000) },
                lines: { data: [{ price: { id: 'price_anual', recurring: { interval: 'year' } } }] },
              },
            },
          },
        },
      ],
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    await svc.completarUpgradesPorPasarela();

    expect(upgrades[0].estado).toBe('COMPLETADO');
    expect(upgrades[0].paidAmountUsd).toBe(450);
    expect(aplicado.income[0].externalTxId).toBe('in_ANUAL_1');
  });

  it('Stripe: una renovación MENSUAL de la suscripción vieja no completa nada', async () => {
    const { svc, upgrades } = servicio({
      whiteLabelId: 'wl-1',
      hotmartSubscriberCode: null,
      stripeSubscriptionId: 'sub_viejo',
      eventosStripe: [
        {
          tenantId: 'neg-1',
          processedAt: REPOSADO,
          payload: {
            data: {
              object: {
                id: 'in_MENSUAL_1',
                currency: 'usd',
                amount_paid: 6_800,
                subscription: 'sub_viejo',
                lines: { data: [{ price: { id: 'price_mensual', recurring: { interval: 'month' } } }] },
              },
            },
          },
        },
      ],
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    const informe = await svc.completarUpgradesPorPasarela();

    expect(upgrades[0].estado).toBe('PENDIENTE');
    expect(informe.esperando[0].nota).toMatch(/no es de un precio ANUAL/i);
  });

  it('un acta que se cayó al aplicarse se reintenta sola: nadie va a re-POSTearla', async () => {
    // El POST que la abrió terminó hace días. Sin reintento, un fallo pasajero
    // deja el acta muerta con el dinero ya cobrado.
    const { svc, upgrades } = servicio({
      whiteLabelId: 'wl-1',
      eventosHotmart: [eventoHotmart()],
      comisionRevienta: true,
    });
    await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    await svc.completarUpgradesPorPasarela();
    expect(upgrades[0].estado).toBe('FALLIDO');

    // Media hora después, el barrido lo vuelve a intentar.
    const segunda = servicio({
      whiteLabelId: 'wl-1',
      eventosHotmart: [eventoHotmart()],
      upgrades,
    });
    const informe = await segunda.svc.completarUpgradesPorPasarela();

    expect(informe.completados).toHaveLength(1);
    expect(upgrades[0].estado).toBe('COMPLETADO');
  });

  it('un segundo POST con la misma referencia devuelve el acta y el enlace, no otra acta', async () => {
    const { svc, upgrades } = servicio({ whiteLabelId: 'wl-1' });

    const primero = await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');
    const segundo = await svc.crear('neg-1', dto({ metodo: 'PASARELA' }), 'admin-1');

    expect(segundo.id).toBe(primero.id);
    expect(segundo.repetido).toBe(true);
    expect(segundo.enlaceDePago.url).toBe('https://pay.example/anual');
    expect(upgrades).toHaveLength(1);
  });
});

describe('upgrade a anual · la previsualización no escribe nada', () => {
  it('devuelve lo que necesita el resumen de la pantalla', async () => {
    const { svc } = servicio({ periodicidad: 'TRIMESTRAL' });

    const p = await svc.previsualizar('neg-1');

    expect(p.periodicidadActual).toBe('TRIMESTRAL');
    expect(p.periodicidadDestino).toBe('ANUAL');
    expect(p.standardPriceUsd).toBe(500);
    expect(p.effectiveAt).toEqual(HOY);
    expect(p.nextRenewalAt.toISOString().slice(0, 10)).toBe('2029-02-28');
    expect(p.sePuede).toBe(true);
    expect(svc.prisma.planUpgrade.create).not.toHaveBeenCalled();
  });

  it('si ya es anual lo dice antes de que nadie pulse nada', async () => {
    const { svc } = servicio({ periodicidad: 'ANUAL' });

    const p = await svc.previsualizar('neg-1');

    expect(p.sePuede).toBe(false);
    expect(p.motivo).toMatch(/ya está en plan ANUAL/i);
  });
});
