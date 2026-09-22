import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MktEngineService } from './mkt-engine.service';
import {
  casoQueCasa,
  catalogoDeContactos,
  sinAcentos,
  MKT_NODE_TYPES,
  MKT_TRIGGERS,
} from './mkt-workflow.util';

/**
 * Los pasos y disparadores del constructor de CONTACTOS (2026-09-21).
 *
 * Por qué estas pruebas y no otras. El motor de contactos ofrecía 9 pasos y un
 * disparador —`tag_added`— que NO existía en el código: se configuraba, se
 * publicaba y no arrancaba nunca. Al abrirlo a 15 pasos, lo que puede costar
 * dinero o credibilidad es:
 *   · que un paso se quede COLGADO y el contacto no salga nunca del flujo,
 *   · que «quitar etiqueta» se lleve por delante las demás etiquetas,
 *   · que «actualizar un dato» escriba el teléfono y parta la ficha en dos
 *     (la identidad vive en phoneKey/phoneNorm + índices únicos parciales),
 *   · que «pasar a otro flujo» permita mover contactos de OTRA marca,
 *   · que el webhook de un cliente llame a nuestra red interna,
 *   · y que el catálogo y el motor vuelvan a separarse.
 *
 * El motor no se instancia con Nest: se le ponen a mano el prisma falso y los
 * servicios que usa, igual que `brand-workflow-pasos.spec.ts`.
 */

const MARCA = 'marca-sellea';

/** El `where` de Prisma que usa el motor, aplicado sobre una fila falsa. */
function casaWhere(fila: any, where: Record<string, any> = {}): boolean {
  return Object.entries(where).every(([campo, cond]) => {
    if (cond && typeof cond === 'object' && 'not' in cond) return fila[campo] !== cond.not;
    return fila[campo] === cond;
  });
}

function motor(opts: { contacto?: any; flujos?: any[] } = {}) {
  const contacto = {
    name: 'Ana',
    email: 'ana@ejemplo.com',
    phone: '+573001112233',
    company: 'Wok Explosivo',
    tags: ['vip', 'bogota'],
    whiteLabelId: MARCA,
    ...(opts.contacto || {}),
  };
  const escrituras: any[] = [];
  const enrolls: { wfId: string; contactId: string; contexto?: any }[] = [];
  const flujos = opts.flujos ?? [];
  const prisma: any = {
    mktContact: {
      findUnique: async () => contacto,
      update: async ({ data }: any) => {
        escrituras.push(data);
        // Se aplica de verdad: así una prueba puede encadenar dos pasos y ver
        // el estado real, no el que suponemos.
        if (data.tags?.set) contacto.tags = data.tags.set;
        if (typeof data.name === 'string') contacto.name = data.name;
        if (typeof data.company === 'string') contacto.company = data.company;
        return contacto;
      },
    },
    whiteLabel: { findUnique: async () => ({ name: 'Sellea' }) },
    // El `where` se aplica TAL CUAL, no a mano: si el motor se dejara un
    // filtro (el de la marca, por ejemplo), este falso devolvería la fila de la
    // otra marca igual que lo haría Postgres — que es justo lo que la prueba
    // tiene que poder ver.
    mktWorkflow: {
      findFirst: async ({ where }: any) => flujos.find((f) => casaWhere(f, where)) ?? null,
      findMany: async ({ where }: any) => flujos.filter((f) => casaWhere(f, where)),
    },
  };
  const actions = { dispatch: vi.fn(async (..._a: unknown[]) => ({})) };
  const svc = Object.create(MktEngineService.prototype) as any;
  svc.prisma = prisma;
  svc.actions = actions;
  svc.log = { warn: vi.fn(), log: vi.fn() };
  // `enroll` sí se sustituye: aquí se prueba QUÉ inscribe cada paso, no el
  // motor durable, que ya tiene sus propias reglas de re-entrada.
  svc.enroll = vi.fn(async (wfId: string, contactId: string, contexto?: any) => {
    enrolls.push({ wfId, contactId, contexto });
    return 'inscrito';
  });
  return { svc, actions, escrituras, enrolls, contacto };
}

const FLUJO = { id: 'wf1', whiteLabelId: MARCA, drip: {}, sendWindow: {} };
const INSCRIPCION = { id: 'e1', contactId: 'c1', context: {} };

const correr = (svc: any, node: any, enr: any = INSCRIPCION, wf = FLUJO) =>
  svc.runNode(wf, { config: {}, ...node }, enr);

describe('quitar etiqueta', () => {
  it('quita SOLO esa y deja las demás', async () => {
    const { svc, escrituras, contacto } = motor();
    const r = await correr(svc, { id: 'n1', type: 'remove_tag', config: { tag: 'vip' }, next: 'n2' });
    expect(escrituras).toEqual([{ tags: { set: ['bogota'] } }]);
    expect(contacto.tags).toEqual(['bogota']);
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('una etiqueta que no tiene no escribe nada', async () => {
    const { svc, escrituras } = motor();
    const r = await correr(svc, { id: 'n1', type: 'remove_tag', config: { tag: 'no-la-tiene' }, next: 'n2' });
    expect(escrituras).toEqual([]);
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('da igual cómo se teclee: «VIP» quita «vip»', async () => {
    const { svc, contacto } = motor();
    await correr(svc, { id: 'n1', type: 'remove_tag', config: { tag: 'VIP' } });
    expect(contacto.tags).toEqual(['bogota']);
  });

  it('sin etiqueta configurada no toca nada y el flujo sigue', async () => {
    const { svc, escrituras } = motor();
    const r = await correr(svc, { id: 'n1', type: 'remove_tag', config: {}, next: 'n2' });
    expect(escrituras).toEqual([]);
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });
});

describe('agregar etiqueta', () => {
  it('la suma a las que ya tiene', async () => {
    const { svc, contacto } = motor();
    await correr(svc, { id: 'n1', type: 'add_tag', config: { tag: 'interesado' } });
    expect(contacto.tags).toEqual(['vip', 'bogota', 'interesado']);
  });

  it('no la duplica si ya la tiene, ni con otra caja', async () => {
    const { svc, escrituras } = motor();
    await correr(svc, { id: 'n1', type: 'add_tag', config: { tag: 'Vip' } });
    expect(escrituras).toEqual([]);
  });
});

describe('el disparador «etiqueta agregada» (la promesa que estaba rota)', () => {
  // La pantalla ofrecía `tag_added` con su campo de etiqueta y en todo el repo
  // no había un solo `fireTrigger('tag_added')`. Se configuraba, se publicaba
  // y el flujo no arrancaba jamás.
  const flujoQueEscucha = (tag?: string, id = 'wf2') => ({
    id,
    whiteLabelId: MARCA,
    status: 'published',
    rootId: 'r1',
    trigger: { type: 'tag_added', ...(tag ? { tag } : {}) },
  });

  it('poner la etiqueta inscribe al contacto en el flujo que la escucha', async () => {
    const { svc, enrolls } = motor({ flujos: [flujoQueEscucha('cliente-vip')] });
    await correr(svc, { id: 'n1', type: 'add_tag', config: { tag: 'cliente-vip' } });
    expect(enrolls.map((e) => e.wfId)).toEqual(['wf2']);
    expect(enrolls[0].contexto).toMatchObject({ etiqueta: 'cliente-vip' });
  });

  it('otra etiqueta NO lo inscribe: la del disparador no es un filtro más', async () => {
    const { svc, enrolls } = motor({ flujos: [flujoQueEscucha('cliente-vip')] });
    await correr(svc, { id: 'n1', type: 'add_tag', config: { tag: 'newsletter' } });
    expect(enrolls).toEqual([]);
  });

  it('sin etiqueta configurada en el disparador, vale cualquiera', async () => {
    const { svc, enrolls } = motor({ flujos: [flujoQueEscucha()] });
    await correr(svc, { id: 'n1', type: 'add_tag', config: { tag: 'lo-que-sea' } });
    expect(enrolls.map((e) => e.wfId)).toEqual(['wf2']);
  });

  it('una etiqueta que ya tenía no dispara nada: no pasó nada nuevo', async () => {
    const { svc, enrolls } = motor({ flujos: [flujoQueEscucha()] });
    await correr(svc, { id: 'n1', type: 'add_tag', config: { tag: 'vip' } });
    expect(enrolls).toEqual([]);
  });

  it('no se cuela en el flujo de OTRA marca', async () => {
    const { svc, enrolls } = motor({
      flujos: [{ ...flujoQueEscucha(), whiteLabelId: 'otra-marca' }],
    });
    await correr(svc, { id: 'n1', type: 'add_tag', config: { tag: 'lo-que-sea' } });
    expect(enrolls).toEqual([]);
  });

  it('quitar la etiqueta dispara «etiqueta eliminada»', async () => {
    const { svc, enrolls } = motor({
      flujos: [{ id: 'wf3', whiteLabelId: MARCA, status: 'published', rootId: 'r1', trigger: { type: 'tag_removed', tag: 'vip' } }],
    });
    await correr(svc, { id: 'n1', type: 'remove_tag', config: { tag: 'vip' } });
    expect(enrolls.map((e) => e.wfId)).toEqual(['wf3']);
  });

  it('cuenta los saltos: una cadena de etiquetas entre flujos no puede ser infinita', async () => {
    const { svc, enrolls } = motor({
      flujos: [{ id: 'wf2', whiteLabelId: MARCA, status: 'published', rootId: 'r1', trigger: { type: 'tag_added' } }],
    });
    await correr(svc, { id: 'n1', type: 'add_tag', config: { tag: 'nueva' } }, { ...INSCRIPCION, context: { saltos: 3 } });
    expect(enrolls[0].contexto).toMatchObject({ saltos: 4 });
  });
});

describe('actualizar un dato del contacto', () => {
  it('escribe el nombre', async () => {
    const { svc, escrituras, contacto } = motor();
    const r = await correr(svc, {
      id: 'n1',
      type: 'update_field',
      config: { campo: 'name', valor: 'Ana María' },
      next: 'n2',
    });
    expect(escrituras).toEqual([{ name: 'Ana María' }]);
    expect(contacto.name).toBe('Ana María');
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('el valor admite {{merge}}', async () => {
    const { svc, escrituras } = motor();
    await correr(svc, { id: 'n1', type: 'update_field', config: { campo: 'company', valor: '{{empresa}} S.A.S.' } });
    expect(escrituras).toEqual([{ company: 'Wok Explosivo S.A.S.' }]);
  });

  it('NO deja escribir el teléfono ni el correo: es la identidad del contacto', async () => {
    // Escribirlos a pelo deja phoneKey/phoneNorm desfasados y revienta —o
    // esquiva— los índices únicos parciales de producción.
    for (const campo of ['phone', 'email', 'phoneNorm', 'deleted', 'optOut', 'whiteLabelId']) {
      const { svc, escrituras } = motor();
      const r = await correr(svc, {
        id: 'n1',
        type: 'update_field',
        config: { campo, valor: '+573009998877' },
        next: 'n2',
      });
      expect(escrituras, campo).toEqual([]);
      expect(r, campo).toEqual({ kind: 'continue', next: 'n2' });
    }
  });

  it('un valor vacío no borra el dato', async () => {
    const { svc, escrituras } = motor();
    await correr(svc, { id: 'n1', type: 'update_field', config: { campo: 'name', valor: '{{no_existe}}' } });
    expect(escrituras).toEqual([]);
  });
});

describe('ramas por respuesta', () => {
  const NODO = {
    id: 'n1',
    type: 'branch_reply',
    config: {
      casos: [
        { id: 'si', label: 'Quiere', palabras: 'sí, claro, dale' },
        { id: 'no', label: 'No quiere', palabras: 'no, no me interesa' },
      ],
    },
    branches: { si: 'nSi', no: 'nNo' },
    next: 'nOtra',
  };

  const conRespuesta = (texto: string) => ({ ...INSCRIPCION, context: { respuesta: texto } });

  it('elige la rama por lo que contestó', async () => {
    const { svc } = motor();
    expect((await correr(svc, NODO, conRespuesta('Sí, me interesa'))).next).toBe('nSi');
  });

  it('da igual la caja y las tildes', async () => {
    const { svc } = motor();
    for (const texto of ['SI', 'si', 'Sí', 'sÍ']) {
      expect((await correr(svc, NODO, conRespuesta(texto))).next, texto).toBe('nSi');
    }
  });

  it('«no» casa por palabra completa, no por trozo', async () => {
    // Con «contiene» a secas, «nos interesa muchísimo» caía en la rama de los
    // que dicen que no, que es exactamente el mensaje equivocado.
    const { svc } = motor();
    expect((await correr(svc, NODO, conRespuesta('nos interesa muchísimo'))).next).toBe('nOtra');
    expect((await correr(svc, NODO, conRespuesta('No, gracias'))).next).toBe('nNo');
  });

  it('una frase configurada sí se busca dentro del texto', async () => {
    const { svc } = motor();
    expect((await correr(svc, NODO, conRespuesta('la verdad no me interesa'))).next).toBe('nNo');
  });

  it('sin respuesta guardada se va por «cualquier otra»', async () => {
    const { svc } = motor();
    expect((await correr(svc, NODO, INSCRIPCION)).next).toBe('nOtra');
  });

  it('lo que no casa con ningún caso se va por «cualquier otra»', async () => {
    const { svc } = motor();
    expect((await correr(svc, NODO, conRespuesta('¿cuánto cuesta?'))).next).toBe('nOtra');
  });

  it('un caso que casa pero sin nada colgado TERMINA ahí', async () => {
    // Si cayera en «cualquier otra», el que dijo que sí recibiría el mensaje
    // de los que no contestaron.
    const { svc } = motor();
    const r = await correr(svc, { ...NODO, branches: {} }, conRespuesta('sí'));
    expect(r).toEqual({ kind: 'continue', next: null });
  });

  it('sin casos configurados sigue por la salida normal', async () => {
    const { svc } = motor();
    const r = await correr(svc, { id: 'n1', type: 'branch_reply', config: {}, next: 'n2' }, conRespuesta('sí'));
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });
});

describe('avisar al equipo', () => {
  it('manda el SMS al número del equipo, NO al del contacto', async () => {
    const { svc, actions } = motor();
    await correr(svc, {
      id: 'n1',
      type: 'notify_team',
      config: { canal: 'sms', to: '+573248088401', message: '{{nombre}} acaba de responder' },
    });
    expect(actions.dispatch).toHaveBeenCalledTimes(1);
    expect(actions.dispatch.mock.calls[0][0]).toMatchObject({
      channel: 'sms',
      to: '+573248088401',
      body: 'Ana acaba de responder',
    });
  });

  it('va marcado como INTERNO: que el vendedor lo abra no es que el contacto responda', async () => {
    // El aviso se guarda con el contactId del contacto, porque es su flujo. Sin
    // la marca, al ABRIR el vendedor su propio correo el proveedor devuelve
    // nuestro id de mensaje, el motor lo lee como «respondió el contacto», le
    // reanuda el «esperar respuesta» por la rama equivocada y dispara
    // «responde/interactúa». Respuestas fantasma causadas por nuestro aviso.
    const { svc, actions } = motor();
    await correr(svc, {
      id: 'n1',
      type: 'notify_team',
      config: { canal: 'email', to: 'equipo@sellea.com', message: 'Ojo' },
    });
    expect(actions.dispatch.mock.calls[0][0]).toMatchObject({ interno: true });
  });

  it('por correo usa el correo del equipo y firma con la marca', async () => {
    const { svc, actions } = motor();
    await correr(svc, {
      id: 'n1',
      type: 'notify_team',
      config: { canal: 'email', to: 'equipo@sellea.com', message: 'Ojo con {{empresa}}' },
    });
    expect(actions.dispatch.mock.calls[0][0]).toMatchObject({
      channel: 'email',
      to: 'equipo@sellea.com',
      subject: 'Aviso de Sellea',
      body: 'Ojo con Wok Explosivo',
    });
  });

  it('sin destinatario no manda nada y el flujo sigue', async () => {
    const { svc, actions } = motor();
    const r = await correr(svc, { id: 'n1', type: 'notify_team', config: { message: 'hola' }, next: 'n2' });
    expect(actions.dispatch).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });
});

describe('pasar a otro flujo', () => {
  it('mete al contacto en el flujo destino y lo saca de este', async () => {
    const { svc, enrolls } = motor({
      flujos: [{ id: 'wf2', whiteLabelId: MARCA, status: 'published', rootId: 'r1', name: 'Bienvenida' }],
    });
    const r = await correr(svc, { id: 'n1', type: 'goto_workflow', config: { workflowId: 'wf2' } });
    expect(enrolls).toMatchObject([{ wfId: 'wf2', contactId: 'c1' }]);
    expect(r).toEqual({ kind: 'removed' });
  });

  it('NO deja apuntar a un flujo de otra marca', async () => {
    // Si no, un flujo de Sellea movería contactos dentro de Clubify.
    const { svc, enrolls } = motor({
      flujos: [{ id: 'wf9', whiteLabelId: 'otra-marca', status: 'published', rootId: 'r1', name: 'Ajena' }],
    });
    const r = await correr(svc, { id: 'n1', type: 'goto_workflow', config: { workflowId: 'wf9' }, next: 'n2' });
    expect(enrolls).toEqual([]);
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('un destino en BORRADOR no vale: el motor no lo ejecutaría', async () => {
    const { svc, enrolls } = motor({
      flujos: [{ id: 'wf3', whiteLabelId: MARCA, status: 'draft', rootId: 'r1', name: 'A medias' }],
    });
    const r = await correr(svc, { id: 'n1', type: 'goto_workflow', config: { workflowId: 'wf3' }, next: 'n2' });
    expect(enrolls).toEqual([]);
    expect(r.kind).toBe('continue');
  });

  it('a los 10 saltos se planta: dos flujos que se apuntan no se pasan el contacto para siempre', async () => {
    const { svc, enrolls } = motor({
      flujos: [{ id: 'wf2', whiteLabelId: MARCA, status: 'published', rootId: 'r1', name: 'El otro' }],
    });
    const r = await correr(svc, { id: 'n1', type: 'goto_workflow', config: { workflowId: 'wf2' } }, { ...INSCRIPCION, context: { saltos: 10 } });
    expect(enrolls).toEqual([]);
    expect(r).toEqual({ kind: 'removed' });
  });

  it('cuenta los saltos al pasar al siguiente flujo', async () => {
    const { svc, enrolls } = motor({
      flujos: [{ id: 'wf2', whiteLabelId: MARCA, status: 'published', rootId: 'r1', name: 'El otro' }],
    });
    await correr(svc, { id: 'n1', type: 'goto_workflow', config: { workflowId: 'wf2' } }, { ...INSCRIPCION, context: { saltos: 3 } });
    expect(enrolls[0].contexto).toMatchObject({ saltos: 4 });
  });

  it('el propio `enroll` corta la cadena aunque el salto venga de otro sitio', async () => {
    const svc = Object.create(MktEngineService.prototype) as any;
    // Sin prisma a propósito: si el candado no cortara antes, esto reventaría.
    svc.prisma = null;
    svc.log = { warn: vi.fn(), log: vi.fn() };
    expect(await svc.enroll('wf2', 'c1', { saltos: 11 })).toBe('omitido');
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

  it('llama a la URL y manda los datos del contacto', async () => {
    const { svc } = motor();
    await correr(svc, { id: 'n1', type: 'webhook', config: { url: 'https://ejemplo.com/hook' } });
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://ejemplo.com/hook');
    const cuerpo = JSON.parse(init.body);
    expect(cuerpo).toMatchObject({ contactId: 'c1', nombre: 'Ana', marca: 'Sellea' });
  });

  it('NO llama a la red interna: nuestra casa no se toca desde el flujo de un cliente', async () => {
    for (const url of [
      'http://localhost:3000/x',
      'http://127.0.0.1/x',
      'https://10.0.0.5/x',
      'http://192.168.1.10/x',
      'http://169.254.169.254/latest/meta-data/',
      'http://postgres.railway.internal:5432',
      'pegar aquí la url',
      'file:///etc/passwd',
    ]) {
      const { svc } = motor();
      const r = await correr(svc, { id: 'n1', type: 'webhook', config: { url }, next: 'n2' });
      expect(global.fetch, url).not.toHaveBeenCalled();
      expect(r, url).toEqual({ kind: 'continue', next: 'n2' });
    }
  });

  it('no sigue redirecciones: una URL pública no puede rebotar a la red interna', async () => {
    const { svc } = motor();
    await correr(svc, { id: 'n1', type: 'webhook', config: { url: 'https://ejemplo.com/hook' } });
    expect((global.fetch as any).mock.calls[0][1].redirect).toBe('manual');
  });

  it('las cabeceras admiten {{merge}}', async () => {
    const { svc } = motor();
    await correr(svc, {
      id: 'n1',
      type: 'webhook',
      config: { url: 'https://ejemplo.com/hook', headers: [{ key: 'X-Contacto', value: '{{nombre}}' }] },
    });
    expect((global.fetch as any).mock.calls[0][1].headers['X-Contacto']).toBe('Ana');
  });

  it('si el otro sistema falla, el flujo NO se rompe', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('sin respuesta');
    }) as any;
    const { svc } = motor();
    const r = await correr(svc, { id: 'n1', type: 'webhook', config: { url: 'https://ejemplo.com/hook' }, next: 'n2' });
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });
});

describe('lo que ya existía sigue igual', () => {
  it('«terminar» saca al contacto del flujo', async () => {
    const { svc } = motor();
    expect(await correr(svc, { id: 'n1', type: 'end' })).toEqual({ kind: 'removed' });
  });

  it('esperar hasta una fecha se entiende en Bogotá, no en UTC', async () => {
    // 08:00 en Bogotá (UTC-5) = 13:00 UTC. Sin esto, el correo de las 8 de la
    // mañana salía a las 3 de la madrugada.
    const { svc } = motor();
    const r = await correr(svc, { id: 'n1', type: 'wait_datetime', config: { at: '2030-03-01T08:00' }, next: 'n2' });
    expect(r.resumeAt.toISOString()).toBe('2030-03-01T13:00:00.000Z');
    expect(r.resumeNodeId).toBe('n2');
  });

  it('una fecha que ya pasó no deja al contacto colgado', async () => {
    const { svc } = motor();
    const r = await correr(svc, { id: 'n1', type: 'wait_datetime', config: { at: '2020-01-01T10:00' }, next: 'n2' });
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });
});

describe('palabras de un caso', () => {
  it('normaliza tildes y mayúsculas', () => {
    expect(sinAcentos('Sí, Señor')).toBe('si, senor');
  });

  it('sin texto no casa nada', () => {
    expect(casoQueCasa('', [{ id: 'a', palabras: 'si' }])).toBeNull();
  });

  it('gana el primer caso configurado', () => {
    const casos = [
      { id: 'a', palabras: 'precio' },
      { id: 'b', palabras: 'precio, coste' },
    ];
    expect(casoQueCasa('cuál es el precio', casos)).toBe('a');
  });
});

// ── Los candados que impiden que esto se vuelva a desincronizar ────────────
// El bug original no fue un fallo de lógica: fue que el catálogo de la pantalla
// prometía un disparador que ningún sitio lanzaba. Estas dos pruebas leen el
// código fuente porque es la única forma de comprobar esa clase de promesa.

const SRC = resolve(process.cwd(), 'src');

function ficherosTs(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) ficherosTs(p, acc);
    else if (nombre.endsWith('.ts') && !nombre.endsWith('.spec.ts')) acc.push(p);
  }
  return acc;
}

describe('el catálogo no promete nada que no exista', () => {
  it('cada paso del catálogo está implementado en el motor', () => {
    const motorSrc = readFileSync(join(SRC, 'marketing', 'mkt-engine.service.ts'), 'utf8');
    const sinImplementar = MKT_NODE_TYPES.filter((p) => !motorSrc.includes(`case '${p.key}':`));
    expect(sinImplementar.map((p) => p.key)).toEqual([]);
  });

  it('cada disparador del catálogo lo lanza alguien de verdad', () => {
    // Justo lo que faltaba con `tag_added`: estaba en la pantalla y en ningún
    // sitio del backend había un `fireTrigger('tag_added')`.
    // SIN COMENTARIOS: si no, el propio comentario que explica el bug de
    // `tag_added` —que escribe la llamada para contarla— satisface el candado
    // aunque nadie la haga de verdad. Un candado que se cumple con una frase
    // no vigila nada.
    const codigo = ficherosTs(SRC)
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    // El evento puede no ser el primer argumento —`disparar(lead.id, 'x', {})`—
    // pero tiene que ir escrito TAL CUAL en la llamada: una variable no cuenta,
    // porque entonces no hay forma de saber si ese disparador se lanza alguna vez.
    const huerfanos = MKT_TRIGGERS.filter((d) => d.key !== 'manual').filter(
      (d) => !new RegExp(`(fireTrigger|disparar)\\([^()'"]*'${d.key}'`).test(codigo),
    );
    expect(huerfanos.map((d) => d.key)).toEqual([]);
  });

  it('todos los pasos y disparadores dicen a qué grupo van y cuánto tardan', () => {
    const cat = catalogoDeContactos();
    expect(cat.disparadores.every((d) => !!d.grupo && (d.latencia === 'minutos' || d.latencia === 'hora'))).toBe(true);
    expect(cat.pasos.every((p) => !!p.grupo && !!p.icono && Array.isArray(p.campos))).toBe(true);
  });
});
