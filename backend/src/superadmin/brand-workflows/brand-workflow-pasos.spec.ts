import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrandWorkflowEngineService } from './brand-workflow-engine.service';
import { destinoInterno } from './brand-workflow.util';

/**
 * Los pasos NUEVOS del constructor de marca (2026-09-21) y el contexto del
 * negocio, que estaba a medias.
 *
 * Por qué estas pruebas y no otras: el constructor de marca tenía 5 pasos y
 * 0 flujos construidos en producción. Al abrirlo a 10 pasos, lo que puede
 * costar dinero o credibilidad es:
 *   · que un paso se quede COLGADO y el negocio no salga nunca del flujo,
 *   · que `split` mande a una rama que no existe,
 *   · que «pasar a otro flujo» permita mover negocios de OTRA marca,
 *   · y que {{plan}} vuelva a salir vacío, que es el bug que traía.
 *
 * El motor no se instancia con Nest: se le ponen a mano el prisma falso y los
 * servicios que usa, igual que hace `reset-sms.spec.ts` con AuthService.
 */

const MARCA = { growBusinessLocationId: 'loc1', growBusinessApiKey: 'clave', growBusinessSwitchNumber: 2 };

function motor(opts: { negocio?: any; dueno?: any; pedidos?: number; flujos?: any[] } = {}) {
  const negocio = {
    name: 'Wok Explosivo',
    status: 'ACTIVE',
    planPeriodicity: 'MENSUAL',
    currentPeriodEnd: new Date('2026-10-04T00:00:00Z'),
    trialEndsAt: null,
    businessCategorySlug: 'restaurant',
    plan: { name: 'Pro' },
    whiteLabel: { name: 'Sellea', ...MARCA },
    whatsappPhone: null,
    phone: '+573001112233',
    ...(opts.negocio || {}),
  };
  const enrolls: any[] = [];
  const logs: any[] = [];
  const prisma: any = {
    tenant: { findUnique: async () => negocio },
    user: { findFirst: async () => opts.dueno ?? { fullName: 'Mauricio', phone: '+573009998877', email: 'mau@wok.com' } },
    order: { count: async () => opts.pedidos ?? 7 },
    brandWorkflow: {
      findFirst: async ({ where }: any) =>
        (opts.flujos ?? []).find(
          (f) => f.id === where.id && f.whiteLabelId === where.whiteLabelId && f.status === where.status,
        ) ?? null,
    },
    brandWorkflowLog: { create: async ({ data }: any) => logs.push(data) },
  };
  const grow = {
    // Con los argumentos declarados: si no, `mock.calls[0][2]` no compila.
    sendSmsWithCreds: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
    sendEmailWithCreds: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  };
  const svc = Object.create(BrandWorkflowEngineService.prototype) as any;
  svc.prisma = prisma;
  svc.grow = grow;
  svc.log = { warn: vi.fn(), log: vi.fn() };
  svc.enroll = vi.fn(async (wfId: string, tenantId: string) => enrolls.push({ wfId, tenantId }));
  return { svc, grow, logs, enrolls, negocio };
}

const FLUJO = { id: 'wf1', whiteLabelId: 'marca-sellea', drip: {}, sendWindow: {} };
const INSCRIPCION = { id: 'e1', tenantId: 't1', context: {} };

const correr = (svc: any, node: any, wf = FLUJO) => svc.runNode(wf, { config: {}, ...node }, INSCRIPCION);

describe('los datos del negocio', () => {
  it('{{plan}} ya no sale vacío: es el plan de verdad', async () => {
    // El bug que traía: la pantalla ofrecía «plan es X» y {{plan}}, y el motor
    // devolvía siempre cadena vacía. La condición no casaba NUNCA.
    const { svc } = motor();
    const ctx = await svc.ctxFor('t1');
    expect(ctx.plan).toBe('Pro');
    expect(ctx.periodicidad).toBe('MENSUAL');
    expect(ctx.pedidos).toBe('7');
    expect(ctx.categoria).toBe('restaurant');
    expect(ctx.vence).toMatch(/octubre/);
  });

  it('un negocio sin plan no rompe nada: queda en blanco', async () => {
    const { svc } = motor({ negocio: { plan: null, planPeriodicity: null, currentPeriodEnd: null } });
    const ctx = await svc.ctxFor('t1');
    expect(ctx.plan).toBe('');
    expect(ctx.vence).toBe('');
  });

  it('el mensaje sale con el plan sustituido', async () => {
    const { svc, grow } = motor();
    await correr(svc, { id: 'n1', type: 'send_sms', config: { message: 'Hola {{owner}}, tu plan {{plan}} vence el {{vence}}' } });
    const texto = grow.sendSmsWithCreds.mock.calls[0][2];
    expect(texto).toContain('Mauricio');
    expect(texto).toContain('Pro');
    expect(texto).not.toContain('{{');
  });
});

describe('esperar hasta una fecha', () => {
  it('espera hasta esa fecha si está por venir', async () => {
    const { svc } = motor();
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
    const r = await correr(svc, { id: 'n1', type: 'wait_datetime', config: { datetime: manana }, next: 'n2' });
    expect(r.kind).toBe('wait');
    expect(r.resumeNodeId).toBe('n2');
    expect(r.resumeAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('si la fecha YA pasó sigue de largo: no deja al negocio colgado para siempre', async () => {
    const { svc } = motor();
    const r = await correr(svc, { id: 'n1', type: 'wait_datetime', config: { datetime: '2020-01-01T10:00' }, next: 'n2' });
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('sin fecha tampoco se queda colgado', async () => {
    const { svc } = motor();
    const r = await correr(svc, { id: 'n1', type: 'wait_datetime', config: {}, next: 'n2' });
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('la hora se entiende en Bogotá, no en UTC', async () => {
    const { svc } = motor();
    const r = await correr(svc, { id: 'n1', type: 'wait_datetime', config: { datetime: '2030-03-01T08:00' } });
    // 08:00 en Bogotá (UTC-5) = 13:00 UTC. Sin esto, el aviso salía a las 3 a. m.
    expect(r.resumeAt.toISOString()).toBe('2030-03-01T13:00:00.000Z');
  });
});

describe('dividir A/B', () => {
  it('con 100/0 siempre cae en la primera', async () => {
    const { svc } = motor();
    for (let i = 0; i < 20; i++) {
      const r = await correr(svc, {
        id: 'n1',
        type: 'split',
        config: { routes: [{ id: 'a', percent: 100 }, { id: 'b', percent: 0 }] },
        branches: { a: 'nA', b: 'nB' },
      });
      expect(r.next).toBe('nA');
    }
  });

  it('reparte entre las dos cuando van al 50', async () => {
    const { svc } = motor();
    const vistas = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const r = await correr(svc, {
        id: 'n1',
        type: 'split',
        config: { routes: [{ id: 'a', percent: 50 }, { id: 'b', percent: 50 }] },
        branches: { a: 'nA', b: 'nB' },
      });
      vistas.add(String(r.next));
    }
    expect([...vistas].sort()).toEqual(['nA', 'nB']);
  });

  it('una ruta sin nodo colgado TERMINA el paso, no salta a otra rama', async () => {
    const { svc } = motor();
    const r = await correr(svc, {
      id: 'n1',
      type: 'split',
      config: { routes: [{ id: 'a', percent: 100 }] },
      branches: {},
    });
    expect(r).toEqual({ kind: 'continue', next: null });
  });

  it('sin rutas configuradas sigue por la salida normal', async () => {
    const { svc } = motor();
    const r = await correr(svc, { id: 'n1', type: 'split', config: {}, next: 'n2' });
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });
});

describe('pasar a otro flujo', () => {
  it('mete al negocio en el flujo destino y lo saca de este', async () => {
    const { svc, enrolls } = motor({
      flujos: [{ id: 'wf2', whiteLabelId: 'marca-sellea', status: 'published', name: 'Bienvenida' }],
    });
    const r = await correr(svc, { id: 'n1', type: 'goto_workflow', config: { workflowId: 'wf2' } });
    expect(enrolls).toEqual([{ wfId: 'wf2', tenantId: 't1' }]);
    expect(r).toEqual({ kind: 'removed' });
  });

  it('NO deja apuntar a un flujo de otra marca', async () => {
    // Si no, un flujo de Sellea movería negocios dentro de Clubify.
    const { svc, enrolls } = motor({
      flujos: [{ id: 'wf9', whiteLabelId: 'otra-marca', status: 'published', name: 'Ajena' }],
    });
    const r = await correr(svc, { id: 'n1', type: 'goto_workflow', config: { workflowId: 'wf9' }, next: 'n2' });
    expect(enrolls).toEqual([]);
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('un destino en BORRADOR no vale: el motor no lo ejecutaría', async () => {
    const { svc, enrolls } = motor({
      flujos: [{ id: 'wf3', whiteLabelId: 'marca-sellea', status: 'draft', name: 'A medias' }],
    });
    const r = await correr(svc, { id: 'n1', type: 'goto_workflow', config: { workflowId: 'wf3' }, next: 'n2' });
    expect(enrolls).toEqual([]);
    expect(r.kind).toBe('continue');
  });
});

describe('avisar al equipo', () => {
  it('manda el SMS al número del equipo, NO al del negocio', async () => {
    const { svc, grow } = motor();
    await correr(svc, { id: 'n1', type: 'notify_brand', config: { canal: 'sms', to: '+573248088401', message: '{{negocio}} no pagó' } });
    expect(grow.sendSmsWithCreds).toHaveBeenCalledTimes(1);
    expect(grow.sendSmsWithCreds.mock.calls[0][1]).toBe('+573248088401');
    expect(grow.sendSmsWithCreds.mock.calls[0][2]).toBe('Wok Explosivo no pagó');
  });

  it('por correo usa el correo del equipo', async () => {
    const { svc, grow } = motor();
    await correr(svc, { id: 'n1', type: 'notify_brand', config: { canal: 'email', to: 'equipo@sellea.com', message: 'Ojo con {{negocio}}' } });
    expect(grow.sendEmailWithCreds).toHaveBeenCalledTimes(1);
    expect(grow.sendEmailWithCreds.mock.calls[0][1]).toBe('equipo@sellea.com');
  });

  it('sin destinatario no manda nada y el flujo sigue', async () => {
    const { svc, grow, logs } = motor();
    const r = await correr(svc, { id: 'n1', type: 'notify_brand', config: { message: 'hola' }, next: 'n2' });
    expect(grow.sendSmsWithCreds).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
    expect(logs.at(-1).status).toBe('skipped');
  });
});

describe('webhook', () => {
  const original = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 })) as any;
  });
  afterEach(() => {
    global.fetch = original;
  });

  it('llama a la URL y manda los datos del negocio', async () => {
    const { svc } = motor();
    await correr(svc, { id: 'n1', type: 'webhook', config: { url: 'https://ejemplo.com/hook' } });
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://ejemplo.com/hook');
    const cuerpo = JSON.parse(init.body);
    expect(cuerpo.negocio).toBe('Wok Explosivo');
    expect(cuerpo.plan).toBe('Pro');
    expect(cuerpo.tenantId).toBe('t1');
  });

  it('una URL inválida no se llama y el flujo sigue', async () => {
    const { svc, logs } = motor();
    const r = await correr(svc, { id: 'n1', type: 'webhook', config: { url: 'pegar aquí la url' }, next: 'n2' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
    expect(logs.at(-1).status).toBe('skipped');
  });

  it('si el otro sistema falla, se anota y el flujo NO se rompe', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('sin respuesta');
    }) as any;
    const { svc, logs } = motor();
    const r = await correr(svc, { id: 'n1', type: 'webhook', config: { url: 'https://ejemplo.com/hook' }, next: 'n2' });
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
    expect(logs.at(-1)).toMatchObject({ status: 'failed', result: 'sin respuesta' });
  });

  it('las cabeceras admiten {{merge}}', async () => {
    const { svc } = motor();
    await correr(svc, {
      id: 'n1',
      type: 'webhook',
      config: { url: 'https://ejemplo.com/hook', headers: [{ key: 'X-Negocio', value: '{{negocio}}' }] },
    });
    const [, init] = (global.fetch as any).mock.calls[0];
    expect(init.headers['X-Negocio']).toBe('Wok Explosivo');
  });
});

describe('el bucle entre flujos', () => {
  it('a los 10 saltos se planta: dos flujos que se apuntan no se pasan el negocio para siempre', async () => {
    // A: espera → va a B. B: espera → va a A. Con re-entrada, cada tick creaba
    // una inscripción nueva y mandaba otra vez los mensajes de en medio.
    const { svc, enrolls } = motor({
      flujos: [{ id: 'wf2', whiteLabelId: 'marca-sellea', status: 'published', name: 'El otro' }],
    });
    const r = await svc.runNode(
      FLUJO,
      { id: 'n1', type: 'goto_workflow', config: { workflowId: 'wf2' } },
      { ...INSCRIPCION, context: { saltos: 10 } },
    );
    expect(enrolls).toEqual([]);
    expect(r).toEqual({ kind: 'removed' });
  });

  it('cuenta los saltos al pasar al siguiente flujo', async () => {
    const { svc } = motor({
      flujos: [{ id: 'wf2', whiteLabelId: 'marca-sellea', status: 'published', name: 'El otro' }],
    });
    await svc.runNode(
      FLUJO,
      { id: 'n1', type: 'goto_workflow', config: { workflowId: 'wf2' } },
      { ...INSCRIPCION, context: { saltos: 3 } },
    );
    expect(svc.enroll).toHaveBeenCalledWith('wf2', 't1', expect.objectContaining({ saltos: 4 }));
  });
});

describe('a dónde puede llamar un webhook', () => {
  it('rechaza la red interna: nuestra propia casa no se toca desde un flujo de un cliente', () => {
    for (const u of [
      'http://localhost:3000/x',
      'http://127.0.0.1/x',
      'https://10.0.0.5/x',
      'http://192.168.1.10/x',
      'http://172.16.4.4/x',
      'http://169.254.169.254/latest/meta-data/',
      'http://postgres.railway.internal:5432',
      'no es una url',
    ]) {
      expect(destinoInterno(u), u).toBe(true);
    }
  });

  it('deja pasar lo de fuera', () => {
    for (const u of ['https://hooks.zapier.com/abc', 'https://api.cliente.com/webhook', 'http://8.8.8.8/x']) {
      expect(destinoInterno(u), u).toBe(false);
    }
  });
});

describe('lo que ya existía sigue igual', () => {
  it('el SMS al dueño se manda por la subcuenta de la marca', async () => {
    const { svc, grow } = motor();
    const r = await correr(svc, { id: 'n1', type: 'send_sms', config: { message: 'Hola' }, next: 'n2' });
    expect(grow.sendSmsWithCreds.mock.calls[0][1]).toBe('+573009998877');
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('una marca sin subcuenta no envía, pero el flujo continúa', async () => {
    const { svc, grow, logs } = motor({ negocio: { whiteLabel: { name: 'Fideliso' } } });
    const r = await correr(svc, { id: 'n1', type: 'send_sms', config: { message: 'Hola' }, next: 'n2' });
    expect(grow.sendSmsWithCreds).not.toHaveBeenCalled();
    expect(logs.at(-1).status).toBe('skipped');
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('«terminar» saca al negocio del flujo', async () => {
    const { svc } = motor();
    expect(await correr(svc, { id: 'n1', type: 'end' })).toEqual({ kind: 'removed' });
  });
});
