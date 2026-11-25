import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FlujosService } from './flujos.service';

/**
 * El motor contra una base EN MEMORIA: lo que se prueba es lo que importa en
 * producción —quién entra, cuándo avanza, que un push no salga dos veces, que
 * un reinicio a mitad no pierda ni repita—, no que Prisma funcione.
 */

type Fila = Record<string, any>;
let seq = 0;

function coincide(f: Fila, w: any): boolean {
  if (!w) return true;
  return Object.entries(w).every(([k, v]: [string, any]) => {
    if (k === 'OR') return (v as any[]).some((x) => coincide(f, x));
    if (k === 'workflow') return Object.entries(v).every(([kk, vv]) => tablas.automationWorkflow.find((x) => x.id === f.workflowId)?.[kk] === vv);
    if (k === 'card') return true;
    if (k === 'detail' && v?.path) return f.detail?.[v.path[0]] === v.equals;
    const x = f[k];
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(x);
      if ('not' in v) return x !== v.not;
      if ('lte' in v) return x <= v.lte;
      if ('lt' in v) return x < v.lt;
      if ('gte' in v) return x >= v.gte;
      if ('gt' in v) return x > v.gt;
    }
    if (v instanceof Date) return x?.getTime?.() === v.getTime();
    return x === v;
  });
}

let tablas: Record<string, Fila[]>;

function tabla(nombre: string, unico?: (f: Fila) => string) {
  const t = () => tablas[nombre];
  const choca = (f: Fila) => unico && t().some((x) => x !== f && unico(x) === unico(f) && unico(f) !== '');
  const aplicar = (f: Fila, data: Fila) => {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      f[k] = v && typeof v === 'object' && 'increment' in v ? (f[k] ?? 0) + v.increment : v;
    }
  };
  return {
    findMany: async ({ where, take }: any = {}) => t().filter((f) => coincide(f, where)).slice(0, take ?? 1e9),
    findFirst: async ({ where }: any = {}) => t().find((f) => coincide(f, where)) ?? null,
    findUnique: async ({ where, include }: any) => {
      const k = Object.keys(where)[0];
      const f =
        k === 'workflowId_customerId'
          ? t().find((x) => x.workflowId === where[k].workflowId && x.customerId === where[k].customerId)
          : t().find((x) => x[k] === where[k]);
      if (!f) return null;
      return include?.workflow ? { ...f, workflow: tablas.automationWorkflow.find((w) => w.id === f.workflowId) } : f;
    },
    count: async ({ where }: any = {}) => t().filter((f) => coincide(f, where)).length,
    create: async ({ data }: any) => {
      const f = { id: `id${++seq}`, createdAt: new Date(), runNumber: 1, attempts: 0, ...data };
      if (choca(f)) throw Object.assign(new Error('unique'), { code: 'P2002' });
      t().push(f);
      return f;
    },
    update: async ({ where, data }: any) => {
      const f = t().find((x) => x.id === where.id);
      if (!f) throw new Error('no existe');
      aplicar(f, data);
      return f;
    },
    updateMany: async ({ where, data }: any) => {
      const fs = t().filter((f) => coincide(f, where));
      fs.forEach((f) => aplicar(f, data));
      return { count: fs.length };
    },
  };
}

const enviados: Array<{ customerId: string; action: any }> = [];
let falloDeEnvio: Error | null = null;

function crear() {
  const prisma: any = {
    automationWorkflow: tabla('automationWorkflow'),
    automationEnrollment: tabla('automationEnrollment', (f) => `${f.workflowId}|${f.customerId}`),
    automationStepLog: tabla('automationStepLog', (f) => f.dedupKey ?? ''),
    customer: tabla('customer'),
    card: tabla('card'),
    tenant: tabla('tenant'),
    notification: tabla('notification'),
    pass: tabla('pass'),
    stamp: tabla('stamp'),
    order: tabla('order'),
  };
  const automations: any = {
    tieneLineaSms: async () => false,
    enviarDesdeFlujo: async (action: any, payload: any) => {
      if (falloDeEnvio) throw falloDeEnvio;
      enviados.push({ customerId: payload.customerId, action });
      return { estado: 'sent', entregados: 1 };
    },
  };
  return new FlujosService(prisma, automations);
}

// 15:00 UTC = 10:00 en Bogotá: dentro del horario de envío.
const T0 = new Date('2026-11-24T15:00:00Z');
const mas = (ms: number) => new Date(T0.getTime() + ms);
const DIA = 86_400_000;

function flujo(extra: Fila = {}) {
  const wf: Fila = {
    id: 'wf1',
    tenantId: 't1',
    name: 'Bienvenida',
    triggerType: 'STAMP_ADDED',
    triggerDays: null,
    triggerConfig: {},
    schemaVersion: 2,
    status: 'active',
    isActive: true,
    reentry: 'once',
    steps: [],
    graph: {
      rootId: 'a',
      nodes: {
        a: { id: 'a', type: 'wait', config: { amount: 2, unit: 'days' }, next: 'b' },
        b: { id: 'b', type: 'push', config: { title: 'Hola {{customerName}}', body: 'Vuelve a {{businessName}}' }, next: null },
      },
    },
    ...extra,
  };
  tablas.automationWorkflow.push(wf);
  return wf;
}

const evento = (customerId = 'c1', tenantId = 't1') => ({ tenantId, customerId, cardId: 'card1', passId: 'p1' });
const recorridos = () => tablas.automationEnrollment;
const pasos = (estado?: string) => tablas.automationStepLog.filter((l) => !estado || l.status === estado);

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  // El reloj fijo en T0: la inscripción toma «ahora» del reloj y los ticks lo
  // reciben. Sin esto, la prueba daría verde o rojo según la hora del día.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  seq = 0;
  enviados.length = 0;
  falloDeEnvio = null;
  tablas = {
    automationWorkflow: [],
    automationEnrollment: [],
    automationStepLog: [],
    customer: [
      { id: 'c1', tenantId: 't1', fullName: 'Ana María Pérez' },
      { id: 'c2', tenantId: 't1', fullName: 'Luis' },
      { id: 'cx', tenantId: 't2', fullName: 'De otro negocio' },
    ],
    card: [{ id: 'card1', tenantId: 't1', type: 'STAMPS' }],
    tenant: [{ id: 't1', timezone: 'America/Bogota', brandName: 'Konys' }],
    notification: [],
    pass: [],
    stamp: [],
    order: [],
  };
});

describe('entrar al flujo', () => {
  it('el evento inscribe al cliente; cada cliente tiene su propio recorrido', async () => {
    const svc = crear();
    flujo();
    await svc.inscribirPorEvento('STAMP_ADDED', evento('c1'));
    await svc.inscribirPorEvento('STAMP_ADDED', evento('c2'));
    expect(recorridos()).toHaveLength(2);
    expect(recorridos().map((r) => r.currentNodeId)).toEqual(['a', 'a']);
  });

  it('evento duplicado → una sola inscripción (y con re-entrada, nunca dos recorridos a la vez)', async () => {
    const svc = crear();
    flujo({ reentry: 'after_finish' });
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    expect(recorridos()).toHaveLength(1);
    expect(recorridos()[0].runNumber).toBe(1);
  });

  it('re-entrada: cuando termina, el siguiente evento abre el recorrido 2', async () => {
    const svc = crear();
    flujo({ reentry: 'after_finish', graph: { rootId: 'b', nodes: { b: { id: 'b', type: 'push', config: { title: 'a', body: 'b' }, next: null } } } });
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    await svc.tick(T0);
    expect(recorridos()[0].status).toBe('done');
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    expect(recorridos()[0]).toMatchObject({ status: 'active', runNumber: 2 });
  });

  it('sin re-entrada, quien ya pasó no vuelve a entrar', async () => {
    const svc = crear();
    flujo({ graph: { rootId: 'b', nodes: { b: { id: 'b', type: 'push', config: { title: 'a', body: 'b' }, next: null } } } });
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    await svc.tick(T0);
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    expect(recorridos()[0]).toMatchObject({ status: 'done', runNumber: 1 });
  });

  it('pausado o borrador: no entra nadie', async () => {
    const svc = crear();
    flujo({ status: 'paused', isActive: false });
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    expect(recorridos()).toHaveLength(0);
  });

  it('cliente de OTRO negocio: no entra aunque el evento diga ese negocio', async () => {
    const svc = crear();
    flujo();
    await svc.inscribirPorEvento('STAMP_ADDED', evento('cx', 't1'));
    expect(recorridos()).toHaveLength(0);
  });

  it('inactividad: un flujo de 7 días no entra con el aviso de los 30', async () => {
    const svc = crear();
    flujo({ triggerType: 'INACTIVITY', triggerDays: 7 });
    await svc.inscribirPorEvento('INACTIVITY', evento());
    expect(recorridos()).toHaveLength(0);
    await svc.inscribirPorEvento('INACTIVITY', evento(), { dias: 7 });
    expect(recorridos()).toHaveLength(1);
  });

  it('«cupón emitido» = alta en una tarjeta de cupón', async () => {
    const svc = crear();
    tablas.card.push({ id: 'cupon1', tenantId: 't1', type: 'COUPON' });
    flujo({ triggerType: 'COUPON_ISSUED' });
    await svc.inscribirPorEvento('PASS_CREATED', evento()); // card1 es de sellos
    expect(recorridos()).toHaveLength(0);
    await svc.inscribirPorEvento('PASS_CREATED', { ...evento(), cardId: 'cupon1' });
    expect(recorridos()).toHaveLength(1);
  });
});

describe('esperar y reanudar', () => {
  it('espera 2 días guardada en la base; antes no envía, después sí, y termina', async () => {
    const svc = crear();
    flujo();
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    await svc.tick(T0);
    expect(recorridos()[0]).toMatchObject({ status: 'active', currentNodeId: 'b' });
    expect(recorridos()[0].nextRunAt.getTime()).toBe(mas(2 * DIA).getTime());

    await svc.tick(mas(DIA)); // al día siguiente: nada
    expect(enviados).toHaveLength(0);

    // Un servicio NUEVO (reinicio / despliegue): lo retoma desde la base.
    const otro = crear();
    await otro.tick(mas(2 * DIA));
    expect(enviados).toHaveLength(1);
    expect(enviados[0].action).toMatchObject({ type: 'SEND_PUSH', title: 'Hola Ana', body: 'Vuelve a Konys' });
    expect(recorridos()[0].status).toBe('done');
    expect(pasos().map((p) => p.status)).toEqual(['entered', 'waited', 'sent', 'done']);
  });

  it('pausar a mitad: el que espera se queda quieto y sigue al reactivar', async () => {
    const svc = crear();
    const wf = flujo();
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    await svc.tick(T0);
    wf.isActive = false;
    await svc.tick(mas(3 * DIA));
    expect(enviados).toHaveLength(0);
    wf.isActive = true;
    await svc.tick(mas(3 * DIA));
    expect(enviados).toHaveLength(1);
  });

  it('fuera de horario (3 am en Bogotá) no escribe: espera a las 8', async () => {
    const svc = crear();
    flujo({ graph: { rootId: 'b', nodes: { b: { id: 'b', type: 'push', config: { title: 'a', body: 'b' }, next: null } } } });
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    const madrugada = new Date('2026-11-24T08:00:00Z'); // 3:00 Bogotá
    recorridos()[0].nextRunAt = madrugada;
    await svc.tick(madrugada);
    expect(enviados).toHaveLength(0);
    expect(recorridos()[0].nextRunAt.toISOString()).toBe('2026-11-24T13:00:00.000Z'); // 8:00 Bogotá
    await svc.tick(new Date('2026-11-24T13:00:00Z'));
    expect(enviados).toHaveLength(1);
  });
});

describe('nunca dos veces el mismo push', () => {
  it('dos ticks a la vez (despliegue): solo uno reclama la fila', async () => {
    const svc = crear();
    flujo({ graph: { rootId: 'b', nodes: { b: { id: 'b', type: 'push', config: { title: 'a', body: 'b' }, next: null } } } });
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    await Promise.all([svc.tick(T0), crear().tick(T0)]);
    expect(enviados).toHaveLength(1);
  });

  it('el tick murió después de enviar: al retomarlo NO reenvía', async () => {
    const svc = crear();
    flujo({ graph: { rootId: 'b', nodes: { b: { id: 'b', type: 'push', config: { title: 'a', body: 'b' }, next: 'c' }, c: { id: 'c', type: 'wait', config: { amount: 1, unit: 'days' }, next: 'd' }, d: { id: 'd', type: 'push', config: { title: 'x', body: 'y' }, next: null } } } });
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    const enr = recorridos()[0];
    // Simulación: el envío de «b» quedó registrado y el proceso murió con la
    // fila `running` sin llegar a guardar el paso siguiente.
    tablas.automationStepLog.push({ id: 'x', dedupKey: `${enr.id}:1:b`, status: 'sending', tenantId: 't1', customerId: 'c1', createdAt: T0 });
    Object.assign(enr, { status: 'running', lockedAt: T0 });
    await svc.tick(mas(11 * 60_000)); // candado caducado → se retoma
    expect(enviados).toHaveLength(0);
    expect(enr.currentNodeId).toBe('d');
  });

  it('tope de 3 mensajes de flujos por cliente y día', async () => {
    const svc = crear();
    for (let i = 0; i < 3; i++) {
      tablas.automationStepLog.push({ id: `p${i}`, tenantId: 't1', customerId: 'c1', status: 'sent', createdAt: T0, detail: { texto: `t${i}` } });
    }
    flujo({ graph: { rootId: 'b', nodes: { b: { id: 'b', type: 'push', config: { title: 'a', body: 'b' }, next: null } } } });
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    await svc.tick(T0);
    expect(enviados).toHaveLength(0);
    expect(pasos('skipped')[0].detail.motivo).toBe('tope_diario');
  });

  it('si la predeterminada le acaba de escribir, el push del flujo se separa unos minutos', async () => {
    const svc = crear();
    tablas.notification.push({ id: 'n', tenantId: 't1', customerId: 'c1', triggerType: 'AUTOMATION', sentAt: T0 });
    flujo({ graph: { rootId: 'b', nodes: { b: { id: 'b', type: 'push', config: { title: 'a', body: 'b' }, next: null } } } });
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    await svc.tick(T0);
    expect(enviados).toHaveLength(0);
    await svc.tick(mas(10 * 60_000));
    expect(enviados).toHaveLength(1);
  });
});

describe('condiciones y errores', () => {
  it('sí / no según los datos reales del cliente', async () => {
    const svc = crear();
    tablas.stamp.push({ id: 's', tenantId: 't1', customerId: 'c1', action: 'STAMP', createdAt: mas(-DIA) });
    flujo({
      graph: {
        rootId: 'q',
        nodes: {
          q: { id: 'q', type: 'condition', config: { field: 'dias_desde_ultima_visita', op: 'lt', value: 7 }, yes: 'si', no: 'no' },
          si: { id: 'si', type: 'push', config: { title: 'Gracias', body: 'x' }, next: null },
          no: { id: 'no', type: 'push', config: { title: 'Te extrañamos', body: 'y' }, next: null },
        },
      },
    });
    await svc.inscribirPorEvento('STAMP_ADDED', evento('c1'));
    await svc.inscribirPorEvento('STAMP_ADDED', evento('c2')); // nunca vino
    await svc.tick(T0);
    const porCliente = Object.fromEntries(enviados.map((e) => [e.customerId, e.action.title]));
    expect(porCliente).toEqual({ c1: 'Gracias', c2: 'Te extrañamos' });
  });

  it('un paso que se borró mientras el cliente esperaba → recorrido cancelado, sin envío', async () => {
    const svc = crear();
    const wf = flujo();
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    await svc.tick(T0);
    delete wf.graph.nodes.b;
    wf.graph.nodes.a.next = null;
    await svc.tick(mas(2 * DIA));
    expect(recorridos()[0].status).toBe('cancelled');
    expect(enviados).toHaveLength(0);
  });

  it('un error inesperado se reintenta con pausa y a la tercera queda en error', async () => {
    const svc = crear();
    flujo({ graph: { rootId: 'b', nodes: { b: { id: 'b', type: 'push', config: { title: 'a', body: 'b' }, next: null } } } });
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    tablas.tenant = null as any; // la base «se cae» al leer el negocio
    await svc.tick(T0);
    expect(recorridos()[0]).toMatchObject({ status: 'active', attempts: 1 });
    await svc.tick(mas(60 * 60_000));
    await svc.tick(mas(3 * 60 * 60_000));
    expect(recorridos()[0]).toMatchObject({ status: 'error', attempts: 3 });
  });

  it('un envío que falla queda registrado como fallido y el flujo sigue', async () => {
    const svc = crear();
    flujo({ graph: { rootId: 'b', nodes: { b: { id: 'b', type: 'push', config: { title: 'a', body: 'b' }, next: null } } } });
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    falloDeEnvio = new Error('APNs caído');
    await svc.tick(T0);
    expect(pasos('failed')).toHaveLength(1);
    expect(pasos('failed')[0].detail.motivo).toBe('error_de_envio');
    expect(recorridos()[0].status).toBe('done');
  });
});

describe('flujos de antes (Extreme House)', () => {
  it('una lista `steps` v1 sigue corriendo: sin horario ni topes, como antes', async () => {
    const svc = crear();
    flujo({
      schemaVersion: 1,
      graph: {},
      steps: [
        { type: 'SEND_PUSH', title: 'Nuevo Sello', body: 'Sigue sumando' },
        { type: 'WAIT', unit: 'hours', amount: 1 },
        { type: 'SEND_PUSH', title: 'Otro', body: 'x' },
      ],
    });
    vi.setSystemTime(new Date('2026-11-24T08:00:00Z'));
    await svc.inscribirPorEvento('STAMP_ADDED', evento());
    expect(recorridos()[0].currentNodeId).toBe('s0');
    await svc.tick(new Date('2026-11-24T08:00:00Z')); // 3 am: el v1 no tenía horario
    expect(enviados).toHaveLength(1);
    await svc.tick(new Date('2026-11-24T09:00:00Z'));
    expect(enviados).toHaveLength(2);
  });
});
