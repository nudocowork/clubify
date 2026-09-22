import { describe, it, expect, vi } from 'vitest';
import { MktEngineService } from './mkt-engine.service';
import { catalogoDeContactos, msDeEsperaDeRespuesta, MKT_NODE_TYPES } from './mkt-workflow.util';

/**
 * Varios disparadores por flujo, sus filtros y la espera de respuesta
 * configurable, en el motor de CONTACTOS (2026-09-22).
 *
 * Por qué estas pruebas: lo que puede costar dinero o credibilidad es
 *   · que un flujo publicado antes de esto deje de arrancar (compatibilidad),
 *   · que el segundo disparador no dispare, o que baste un filtro de varios,
 *   · que el barrido de cada hora inscriba a los importados sin mirar los
 *     filtros —lo hacía: el filtro solo valía para el alta a mano—,
 *   · y que «Esperar respuesta» cambie los 3 días de los flujos ya publicados.
 *
 * El motor no se instancia con Nest: prisma falso a mano, como en mkt-pasos.spec.ts.
 */

const MARCA = 'marca-sellea';

function motor(opts: { flujos?: any[]; contacto?: any; contactos?: any[] } = {}) {
  const contacto = {
    name: 'Ana',
    email: 'ana@ejemplo.com',
    phone: '+573001112233',
    company: 'Wok Explosivo',
    tags: ['vip'],
    whiteLabelId: MARCA,
    ...(opts.contacto || {}),
  };
  const flujos = (opts.flujos ?? []).map((f) => ({
    whiteLabelId: MARCA,
    status: 'published',
    rootId: 'r1',
    createdAt: new Date(Date.now() - 86400000),
    triggers: [],
    ...f,
  }));
  const enrolls: { wfId: string; contactId: string; contexto?: any }[] = [];
  const prisma: any = {
    mktContact: {
      findUnique: async () => contacto,
      // El barrido pide los contactos nuevos de la marca del flujo.
      findMany: async ({ where }: any) => (opts.contactos ?? []).filter((c) => c.whiteLabelId === where.whiteLabelId),
    },
    whiteLabel: { findUnique: async () => ({ name: 'Sellea' }) },
    mktWorkflow: {
      findMany: async ({ where }: any) =>
        flujos.filter((f) => f.status === 'published' && (!where.whiteLabelId || f.whiteLabelId === where.whiteLabelId)),
    },
  };
  const svc = Object.create(MktEngineService.prototype) as any;
  svc.prisma = prisma;
  svc.actions = { dispatch: vi.fn() };
  svc.log = { warn: vi.fn(), log: vi.fn() };
  svc.enroll = vi.fn(async (wfId: string, contactId: string, contexto?: any) => {
    enrolls.push({ wfId, contactId, contexto });
    return 'inscrito';
  });
  return { svc, enrolls };
}

describe('los flujos de ANTES siguen arrancando igual', () => {
  it('con la lista vacía se usa su `trigger` de siempre', async () => {
    const { svc, enrolls } = motor({ flujos: [{ id: 'viejo', trigger: { type: 'contact_created' }, triggers: [] }] });
    await svc.fireTrigger('contact_created', 'c1', MARCA);
    expect(enrolls.map((e) => e.wfId)).toEqual(['viejo']);
  });

  it('con los filtros que ya tuviera en `trigger`', async () => {
    const { svc, enrolls } = motor({
      flujos: [
        { id: 'pasa', trigger: { type: 'contact_created', filters: [{ field: 'empresa', op: 'contains', value: 'wok' }] } },
        { id: 'no-pasa', trigger: { type: 'contact_created', filters: [{ field: 'empresa', op: 'eq', value: 'otra' }] } },
      ],
    });
    await svc.fireTrigger('contact_created', 'c1', MARCA);
    expect(enrolls.map((e) => e.wfId)).toEqual(['pasa']);
  });

  it('la etiqueta pedida de un `tag_added` viejo se sigue respetando', async () => {
    const { svc, enrolls } = motor({ flujos: [{ id: 'vip', trigger: { type: 'tag_added', tag: 'VIP' } }] });
    await svc.fireTrigger('tag_added', 'c1', MARCA, { etiqueta: 'newsletter' });
    expect(enrolls).toEqual([]);
    await svc.fireTrigger('tag_added', 'c1', MARCA, { etiqueta: 'vip' });
    expect(enrolls.map((e) => e.wfId)).toEqual(['vip']);
  });
});

describe('varios disparadores: entra si casa CUALQUIERA', () => {
  const FLUJO = {
    id: 'wf',
    trigger: { type: 'tag_added', tag: 'cliente' },
    triggers: [
      { type: 'tag_added', tag: 'cliente' },
      { type: 'email_reply', filters: [{ field: 'respuesta', op: 'contains', value: ['precio', 'cuánto'] }] },
    ],
  };

  it('el SEGUNDO disparador también arranca el flujo', async () => {
    const { svc, enrolls } = motor({ flujos: [FLUJO] });
    await svc.fireTrigger('email_reply', 'c1', MARCA, { respuesta: '¿Cuál es el precio?' });
    expect(enrolls.map((e) => e.wfId)).toEqual(['wf']);
  });

  it('y el primero sigue funcionando', async () => {
    const { svc, enrolls } = motor({ flujos: [FLUJO] });
    await svc.fireTrigger('tag_added', 'c1', MARCA, { etiqueta: 'Cliente' });
    expect(enrolls.map((e) => e.wfId)).toEqual(['wf']);
  });

  it('si ninguno casa, no entra', async () => {
    const { svc, enrolls } = motor({ flujos: [FLUJO] });
    await svc.fireTrigger('email_reply', 'c1', MARCA, { respuesta: 'gracias' });
    await svc.fireTrigger('tag_added', 'c1', MARCA, { etiqueta: 'newsletter' });
    expect(enrolls).toEqual([]);
  });

  it('con lista, el `trigger` suelto ya no cuenta', async () => {
    const { svc, enrolls } = motor({ flujos: [{ id: 'wf', trigger: { type: 'contact_created' }, triggers: [{ type: 'tag_added' }] }] });
    await svc.fireTrigger('contact_created', 'c1', MARCA);
    expect(enrolls).toEqual([]);
  });

  it('dentro de un disparador se exigen TODOS sus filtros', async () => {
    const { svc, enrolls } = motor({
      flujos: [
        {
          id: 'wf',
          triggers: [
            {
              type: 'email_reply',
              filters: [
                { field: 'respuesta', op: 'contains', value: ['sí'] },
                { field: 'tags', op: 'has_tag', value: ['cliente'] },
              ],
            },
          ],
        },
      ],
    });
    // Dice «sí» pero no tiene la etiqueta «cliente» (tiene «vip»).
    await svc.fireTrigger('email_reply', 'c1', MARCA, { respuesta: 'sí, me interesa' });
    expect(enrolls).toEqual([]);
  });

  it('la inscripción recuerda por QUÉ disparador entró', async () => {
    const { svc, enrolls } = motor({ flujos: [FLUJO] });
    await svc.fireTrigger('email_reply', 'c1', MARCA, { respuesta: 'precio?' });
    expect(enrolls[0].contexto).toMatchObject({
      respuesta: 'precio?',
      disparador: 'Responde / interactúa #2',
      disparadorTipo: 'email_reply',
    });
  });

  it('un filtro con un operador desconocido no deja entrar a nadie', async () => {
    const { svc, enrolls } = motor({
      flujos: [{ id: 'wf', triggers: [{ type: 'contact_created', filters: [{ field: 'nombre', op: 'parecido', value: 'ana' }] }] }],
    });
    await svc.fireTrigger('contact_created', 'c1', MARCA);
    expect(enrolls).toEqual([]);
  });
});

describe('el barrido de cada hora de «Contacto nuevo» aplica los filtros', () => {
  // Los importados y los que llegan del tablero de ventas solo entran por aquí.
  const contactos = [
    { id: 'vip', whiteLabelId: MARCA, name: 'Ana', email: 'a@x.com', phone: null, company: null, tags: ['vip'] },
    { id: 'normal', whiteLabelId: MARCA, name: 'Luis', email: 'l@x.com', phone: null, company: null, tags: [] },
  ];

  it('solo inscribe a los que cumplen el filtro', async () => {
    const { svc, enrolls } = motor({
      contactos,
      flujos: [{ id: 'wf', triggers: [{ type: 'contact_created', filters: [{ field: 'tags', op: 'has_tag', value: ['vip'] }] }] }],
    });
    await svc.scanTriggers();
    expect(enrolls.map((e) => e.contactId)).toEqual(['vip']);
  });

  it('sin filtros inscribe a todos, como siempre', async () => {
    const { svc, enrolls } = motor({ contactos, flujos: [{ id: 'wf', trigger: { type: 'contact_created' } }] });
    await svc.scanTriggers();
    expect(enrolls.map((e) => e.contactId).sort()).toEqual(['normal', 'vip']);
  });

  it('vale también para un «Contacto nuevo» que es el SEGUNDO disparador', async () => {
    const { svc, enrolls } = motor({
      contactos,
      flujos: [
        {
          id: 'wf',
          trigger: { type: 'tag_added' },
          triggers: [{ type: 'tag_added' }, { type: 'contact_created', filters: [{ field: 'nombre', op: 'eq', value: 'luis' }] }],
        },
      ],
    });
    await svc.scanTriggers();
    expect(enrolls).toEqual([
      { wfId: 'wf', contactId: 'normal', contexto: { disparador: 'Contacto nuevo #2', disparadorTipo: 'contact_created' } },
    ]);
  });

  it('un flujo que no escucha «Contacto nuevo» no inscribe a nadie', async () => {
    const { svc, enrolls } = motor({ contactos, flujos: [{ id: 'wf', trigger: { type: 'tag_added' } }] });
    await svc.scanTriggers();
    expect(enrolls).toEqual([]);
  });
});

describe('«Esperar respuesta» con tiempo máximo configurable', () => {
  const correr = async (config: any) => {
    const { svc } = motor();
    const antes = Date.now();
    const r = await svc.runNode(
      { id: 'wf', whiteLabelId: MARCA, drip: {}, sendWindow: {} },
      { id: 'n1', type: 'wait_reply', config, yes: 'si', no: 'no' },
      { id: 'e1', contactId: 'c1', context: {} },
    );
    return { r, espera: r.resumeAt.getTime() - antes };
  };
  const H = 3600000;
  const D = 24 * H;

  it('sin configurar espera los 3 días de siempre (los flujos publicados no cambian)', async () => {
    const { r, espera } = await correr({});
    expect(r.kind).toBe('waitReply');
    expect(espera).toBeGreaterThanOrEqual(3 * D);
    expect(espera).toBeLessThan(3 * D + 60000);
  });

  it('respeta la cantidad y la unidad', async () => {
    const { espera } = await correr({ amount: 2, unit: 'hours' });
    expect(espera).toBeGreaterThanOrEqual(2 * H);
    expect(espera).toBeLessThan(2 * H + 60000);
    expect((await correr({ amount: 45, unit: 'minutes' })).espera).toBeLessThan(46 * 60000);
    expect((await correr({ amount: 1, unit: 'days' })).espera).toBeLessThan(D + 60000);
  });

  it('una cantidad inválida vuelve a los 3 días, no a 0', async () => {
    for (const amount of [0, -1, 'abc', null]) {
      expect(msDeEsperaDeRespuesta({ amount, unit: 'hours' }), String(amount)).toBe(3 * D);
    }
  });

  it('una unidad desconocida se lee en días', () => {
    expect(msDeEsperaDeRespuesta({ amount: 2, unit: 'lunas' })).toBe(2 * D);
  });

  it('tiene tope de un año: un cero de más no deja la inscripción en error', () => {
    expect(msDeEsperaDeRespuesta({ amount: 100000, unit: 'days' })).toBe(365 * D);
  });

  it('el catálogo ofrece cantidad + unidad con 3 días por defecto y la tarjeta lo dice', () => {
    const paso = MKT_NODE_TYPES.find((p) => p.key === 'wait_reply')!;
    expect(paso.campos.map((c) => [c.key, c.def])).toEqual([
      ['amount', 3],
      ['unit', 'days'],
    ]);
    expect(paso.campos[1].opciones?.map((o) => o.value)).toEqual(['minutes', 'hours', 'days']);
    expect(paso.resumen).toBe('Espera respuesta · {amount} {unit}');
  });
});

describe('el catálogo dice qué se puede filtrar en cada disparador', () => {
  const cat = catalogoDeContactos();
  const de = (key: string) => cat.disparadores.find((d) => d.key === key)!;

  it('«Responde / interactúa» filtra por el contenido de la respuesta y nace con «contiene»', () => {
    expect(de('email_reply').filtros?.nuevo).toEqual({ field: 'respuesta', op: 'contains' });
    expect(de('email_reply').filtros?.campos[0]).toEqual({ key: 'respuesta', label: 'Contenido de la respuesta' });
  });

  it('la inscripción manual no ofrece filtros: no pasa por el motor de disparadores', () => {
    expect(de('manual').filtros?.campos).toEqual([]);
  });

  it('la respuesta solo se ofrece donde el disparador la trae', () => {
    expect(de('contact_created').filtros?.campos.map((c) => c.key)).not.toContain('respuesta');
    expect(de('sales_stage_changed').filtros?.campos.map((c) => c.key)).toContain('etapa');
  });

  it('los 12 operadores, y los de etiqueta solo sobre «Etiquetas»', () => {
    expect(cat.operadores).toHaveLength(12);
    expect(cat.operadores.find((o) => o.value === 'has_tag')?.campos).toEqual(['tags']);
  });
});
