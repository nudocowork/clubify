import { describe, it, expect } from 'vitest';
import { HotmartService } from './hotmart.service';
import { BusinessGroupsService } from '../business-groups/business-groups.service';

/**
 * Los avisos de un cobro fallido, en negocios sueltos y en GRUPOS.
 *
 * Tres fallos del arqueo del 2026-09-17:
 *
 * 1. «Tu pago falló… para no pausar tu cuenta» salía en CADA reintento de
 *    Hotmart: Delizzibo 4 veces (3 en tres horas), Café Macondo 2 en 40 minutos,
 *    y AutoTech —pausada desde julio— 4 veces en septiembre.
 * 2. La ruta de GRUPO solo marcaba el grupo como PAST_DUE. Ni SMS ni correo a
 *    ningún dueño, ni aviso al equipo: el Grupo Aldehir (Cevichería Marea
 *    Místika, Jamarea y Hacienda Don Antonio) cobraba el 17-09 y, si fallaba,
 *    sus tres negocios se suspendían al día 6 sin enterarse de nada.
 * 3. Al aprobarse el cobro del grupo, ningún dueño recibía «pago recibido».
 *
 * La base falsa evalúa las condiciones de `update`/`updateMany` como lo haría
 * Postgres (igualdad, null, `not`, `lt`, `OR`, `increment`), así que las pruebas
 * ejercen el reclamo atómico de verdad y no una copia de la regla.
 */

type Fila = Record<string, any>;

function cumple(fila: Fila, where: Record<string, any>): boolean {
  return Object.entries(where).every(([campo, cond]) => {
    if (campo === 'OR') return (cond as any[]).some((w) => cumple(fila, w));
    const valor = fila[campo] ?? null;
    if (cond === null) return valor === null;
    if (cond instanceof Date) return valor instanceof Date && valor.getTime() === cond.getTime();
    if (typeof cond === 'object') {
      if ('not' in cond) return valor !== cond.not;
      if ('lt' in cond) return valor !== null && valor < cond.lt;
      throw new Error(`operador no soportado en ${campo}`);
    }
    return valor === cond;
  });
}

function aplicar(fila: Fila, data: Record<string, any>) {
  for (const [campo, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in v) fila[campo] = (fila[campo] ?? 0) + v.increment;
    else fila[campo] = v;
  }
}

function negocio(id: string, over: Fila = {}): Fila {
  return {
    id,
    brandName: id,
    status: 'ACTIVE',
    failedPaymentCount: 0,
    firstFailedAt: null,
    lastPaymentAttemptAt: null,
    paymentFailureNoticeSentAt: null,
    ...over,
  };
}

function montar(filas: Fila[], grupo?: { currentPeriodEndDespues: Date | null }) {
  const tenants = new Map(filas.map((f) => [f.id, f]));
  const prisma: any = {
    tenant: {
      update: async ({ where, data }: any) => {
        const f = tenants.get(where.id)!;
        aplicar(f, data);
        return f;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const f of tenants.values()) {
          if (cumple(f, where)) {
            aplicar(f, data);
            count++;
          }
        }
        return { count };
      },
    },
    businessGroup: {
      findUnique: async () => ({ currentPeriodEnd: grupo?.currentPeriodEndDespues ?? null }),
    },
  };

  const sms: { tenantId: string; plantilla: string }[] = [];
  const correos: { tenantId: string; templateId: string }[] = [];
  const equipo: { kind: string; brandName: string }[] = [];
  const billing: any = {
    auditLifecycle: async () => undefined,
    notifyBillingTeam: async (kind: string, brandName: string) => {
      equipo.push({ kind, brandName });
    },
    resolveBillingTarget: async (tenantId: string) => ({ creds: {}, phone: tenantId }),
  };
  const growBusiness: any = {
    sendSmsWithCreds: async (_c: unknown, phone: string, msg: string) => {
      sms.push({ tenantId: phone, plantilla: msg });
      return { ok: true };
    },
  };
  const smsTemplates: any = { render: async (id: string) => id };
  const brandEmail: any = {
    sendTemplate: async (a: { tenantId: string; templateId: string }) => {
      correos.push({ tenantId: a.tenantId, templateId: a.templateId });
    },
  };
  const svc: any = new HotmartService(
    prisma, {} as any, growBusiness, {} as any, {} as any, billing, {} as any,
    {} as any, {} as any, smsTemplates, brandEmail, {} as any, {} as any, {} as any, {} as any,
  );
  svc.notifyReferralChain = async () => undefined;
  svc.maybeSendAdminNotice = async () => false;

  /** Lo que leería `findTenant` / `buscarGrupoDelEvento` en ese momento. */
  const foto = (id: string) => ({ ...tenants.get(id)! });
  const fotoDelGrupo = (fin: Date | null) => ({
    id: 'g1',
    name: 'Grupo Aldehir',
    currentPeriodEnd: fin,
    priceUsd: 150,
    negocios: [...tenants.values()].map((f) => ({ ...f })),
  });
  // Los SMS salen con `.then()` sin esperar, como en producción.
  const drenar = () => new Promise((r) => setTimeout(r, 0));
  return { svc, tenants, sms, correos, equipo, foto, fotoDelGrupo, drenar };
}

describe('negocio suelto: «tu pago falló» una vez por episodio', () => {
  it('el primer fallo avisa al dueño (SMS y correo) y al equipo', async () => {
    const m = montar([negocio('macondo')]);
    await m.svc.runEventLogic('PURCHASE_DELAYED', m.foto('macondo'), {});
    await m.drenar();
    expect(m.sms).toEqual([{ tenantId: 'macondo', plantilla: 'payment_failed' }]);
    expect(m.correos.map((c) => c.templateId)).toEqual(['email_payment_failed']);
    expect(m.equipo).toHaveLength(1);
    expect(m.tenants.get('macondo')!.failedPaymentCount).toBe(1);
  });

  it('el reintento de Hotmart del mismo episodio NO repite ningún aviso', async () => {
    const m = montar([negocio('delizzibo')]);
    for (let i = 0; i < 4; i++) {
      await m.svc.runEventLogic('PURCHASE_DELAYED', m.foto('delizzibo'), {});
    }
    await m.drenar();
    expect(m.sms).toHaveLength(1);
    expect(m.correos).toHaveLength(1);
    expect(m.equipo).toHaveLength(1);
    expect(m.tenants.get('delizzibo')!.failedPaymentCount).toBe(4);
  });

  it('una cuenta ya pausada no recibe «paga para no pausar tu cuenta»', async () => {
    const m = montar([negocio('autotech', { status: 'SUSPENDED' })]);
    await m.svc.runEventLogic('PURCHASE_DELAYED', m.foto('autotech'), {});
    await m.drenar();
    expect(m.sms).toHaveLength(0);
    expect(m.correos).toHaveLength(0);
  });

  it('si el cron de mora ya avisó en el episodio, el reintento tampoco repite', async () => {
    const fallo = new Date('2026-09-16T14:00:00Z');
    const m = montar([
      negocio('valmont', {
        failedPaymentCount: 1,
        firstFailedAt: fallo,
        paymentFailureNoticeSentAt: new Date('2026-09-17T03:00:00Z'),
      }),
    ]);
    await m.svc.runEventLogic('PURCHASE_DELAYED', m.foto('valmont'), {});
    await m.drenar();
    expect(m.sms).toHaveLength(0);
  });

  it('pagó y vuelve a fallar el mes siguiente → avisa otra vez', async () => {
    const m = montar([
      negocio('quipao', {
        failedPaymentCount: 0,
        firstFailedAt: null,
        paymentFailureNoticeSentAt: null,
      }),
    ]);
    await m.svc.runEventLogic('PURCHASE_DELAYED', m.foto('quipao'), {});
    // Entra el pago: activatePurchase pone todo esto a cero.
    aplicar(m.tenants.get('quipao')!, {
      failedPaymentCount: 0,
      firstFailedAt: null,
      paymentFailureNoticeSentAt: null,
    });
    await m.svc.runEventLogic('PURCHASE_DELAYED', m.foto('quipao'), {});
    await m.drenar();
    expect(m.sms).toHaveLength(2);
  });

  it('un firstFailedAt viejo que sobrevivió a un pago no se hereda', async () => {
    const viejo = new Date('2026-05-01T12:00:00Z');
    const m = montar([
      negocio('hydor', {
        failedPaymentCount: 0,
        firstFailedAt: viejo,
        paymentFailureNoticeSentAt: new Date('2026-05-02T03:00:00Z'),
      }),
    ]);
    await m.svc.runEventLogic('PURCHASE_DELAYED', m.foto('hydor'), {});
    await m.drenar();
    // Con la fecha de mayo heredada, la gracia estaría vencida hace meses:
    // suspensión inmediata y sin aviso.
    expect(m.tenants.get('hydor')!.firstFailedAt.getTime()).toBeGreaterThan(viejo.getTime());
    expect(m.sms).toHaveLength(1);
  });
});

describe('grupo: el fallo del cobro llega a CADA negocio del grupo', () => {
  const NEGOCIOS = () => [negocio('mistika'), negocio('jamarea'), negocio('don-antonio')];

  it('cada dueño recibe su aviso y cada negocio queda en mora; el equipo, un aviso', async () => {
    const m = montar(NEGOCIOS());
    await m.svc.avisosDelCobroDeGrupo('PURCHASE_DELAYED', 'group_past_due:g1', m.fotoDelGrupo(null));
    await m.drenar();
    expect(m.sms.map((s) => s.tenantId).sort()).toEqual(['don-antonio', 'jamarea', 'mistika']);
    expect(m.correos).toHaveLength(3);
    for (const f of m.tenants.values()) {
      expect(f.failedPaymentCount).toBe(1);
      expect(f.firstFailedAt).toBeInstanceOf(Date);
    }
    expect(m.equipo).toEqual([
      { kind: 'renovacion_fallida', brandName: 'Grupo Aldehir (grupo: mistika, jamarea, don-antonio)' },
    ]);
  });

  it('el reintento de Hotmart del cobro del grupo no repite nada', async () => {
    const m = montar(NEGOCIOS());
    await m.svc.avisosDelCobroDeGrupo('PURCHASE_DELAYED', 'group_past_due:g1', m.fotoDelGrupo(null));
    await m.svc.avisosDelCobroDeGrupo('PURCHASE_DELAYED', 'group_past_due:g1', m.fotoDelGrupo(null));
    await m.drenar();
    expect(m.sms).toHaveLength(3);
    expect(m.equipo).toHaveLength(1);
  });

  it('un negocio del grupo ya pausado no recibe el aviso', async () => {
    const m = montar([negocio('mistika'), negocio('jamarea', { status: 'SUSPENDED' })]);
    await m.svc.avisosDelCobroDeGrupo('PURCHASE_PROTEST', 'group_past_due:g1', m.fotoDelGrupo(null));
    await m.drenar();
    expect(m.sms.map((s) => s.tenantId)).toEqual(['mistika']);
  });

  it('un evento que no es de fallo no toca la mora', async () => {
    const m = montar(NEGOCIOS());
    await m.svc.avisosDelCobroDeGrupo('SUBSCRIPTION_CANCELLATION', 'group_suspended:g1', m.fotoDelGrupo(null));
    await m.drenar();
    expect(m.sms).toHaveLength(0);
    for (const f of m.tenants.values()) expect(f.failedPaymentCount).toBe(0);
  });
});

describe('grupo: cobro aprobado', () => {
  const antes = new Date('2026-09-17T14:00:00Z');
  const despues = new Date('2026-10-17T14:00:00Z');

  it('cada dueño recibe «pago recibido» y el equipo «pago procesado»', async () => {
    const m = montar([negocio('mistika'), negocio('jamarea')], { currentPeriodEndDespues: despues });
    await m.svc.avisosDelCobroDeGrupo('PURCHASE_APPROVED', 'group_activated:g1', m.fotoDelGrupo(antes));
    await m.drenar();
    expect(m.sms.map((s) => s.plantilla)).toEqual(['payment_confirmed', 'payment_confirmed']);
    expect(m.correos.map((c) => c.templateId)).toEqual([
      'email_payment_confirmed',
      'email_payment_confirmed',
    ]);
    expect(m.equipo.map((e) => e.kind)).toEqual(['pago_procesado']);
  });

  it('quien estaba pausado recibe «cuenta reactivada»', async () => {
    const m = montar([negocio('mistika', { status: 'SUSPENDED' })], { currentPeriodEndDespues: despues });
    await m.svc.avisosDelCobroDeGrupo('PURCHASE_APPROVED', 'group_activated:g1', m.fotoDelGrupo(antes));
    await m.drenar();
    expect(m.sms.map((s) => s.plantilla)).toEqual(['account_reactivated']);
  });

  it('PURCHASE_COMPLETE (cierre de garantía del mismo pago) no avisa', async () => {
    const m = montar([negocio('mistika')], { currentPeriodEndDespues: despues });
    await m.svc.avisosDelCobroDeGrupo('PURCHASE_COMPLETE', 'group_activated:g1', m.fotoDelGrupo(antes));
    await m.drenar();
    expect(m.sms).toHaveLength(0);
    expect(m.equipo).toHaveLength(0);
  });

  it('el pago que resuelve un fallo avisa aunque la fecha no se mueva', async () => {
    // Un APPROVED de recuperación sin `date_next_charge` deja la misma fecha;
    // sin esto la mora quedaba limpia y ningún dueño se enteraba del pago.
    const m = montar(
      [negocio('mistika', { failedPaymentCount: 2, firstFailedAt: new Date('2026-09-17T14:00:00Z') })],
      { currentPeriodEndDespues: antes },
    );
    await m.svc.avisosDelCobroDeGrupo('PURCHASE_APPROVED', 'group_activated:g1', m.fotoDelGrupo(antes));
    await m.drenar();
    expect(m.sms.map((s) => s.plantilla)).toEqual(['payment_confirmed']);
    expect(m.equipo.map((e) => e.kind)).toEqual(['pago_procesado']);
  });

  it('si el período no avanzó y nadie estaba pausado, es un reenvío: no avisa', async () => {
    const m = montar([negocio('mistika')], { currentPeriodEndDespues: antes });
    await m.svc.avisosDelCobroDeGrupo('PURCHASE_APPROVED', 'group_activated:g1', m.fotoDelGrupo(antes));
    await m.drenar();
    expect(m.sms).toHaveLength(0);
  });
});

describe('grupo: un cobro confirmado cierra la mora de cada negocio', () => {
  function capturar() {
    const datos: any[] = [];
    const prisma: any = {
      businessGroup: { update: (a: any) => a },
      tenant: {
        updateMany: (a: any) => {
          datos.push(a.data);
          return a;
        },
      },
      $transaction: async () => [],
    };
    const svc: any = new BusinessGroupsService(prisma, {} as any);
    return { svc, datos };
  }

  it('con cobro: contador, ancla y marcas de aviso a cero', async () => {
    const { svc, datos } = capturar();
    await svc.applyStatus('g1', 'ACTIVE', { currentPeriodEnd: new Date(), bumpCharge: true });
    expect(datos[0]).toMatchObject({
      status: 'ACTIVE',
      failedPaymentCount: 0,
      firstFailedAt: null,
      paymentFailureNoticeSentAt: null,
      paymentReminderSentFor: null,
      pausePendingNoticeSentAt: null,
      preReminder7dSentFor: null,
      preReminder3dSentFor: null,
      preReminderTodaySentFor: null,
    });
  });

  it('sin cobro (reactivar a mano sin pago) no borra la mora', async () => {
    const { svc, datos } = capturar();
    await svc.applyStatus('g1', 'ACTIVE', { bumpCharge: false });
    expect(datos[0]).not.toHaveProperty('failedPaymentCount');
  });
});
