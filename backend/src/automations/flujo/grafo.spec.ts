import { describe, it, expect } from 'vitest';
import {
  Grafo,
  evaluarCondicion,
  grafoDeLista,
  grafoDelFlujo,
  msHastaHorario,
  nodoActual,
  problemasDeForma,
  problemasParaActivar,
  variablesDesconocidas,
} from './grafo';
import { PLANTILLAS_FLUJO, contarPasos, grafoDePlantilla } from './plantillas-flujo';

const ctx = { smsDisponible: true, tarjetas: ['card-1'] };
let n = 0;
const id = () => `n${++n}`;

function lineal(...tipos: Array<[string, Record<string, any>]>): Grafo {
  const nodes: Grafo['nodes'] = {};
  tipos.forEach(([type, config], i) => {
    nodes[`x${i}`] = { id: `x${i}`, type: type as any, config, next: i + 1 < tipos.length ? `x${i + 1}` : null };
  });
  return { rootId: tipos.length ? 'x0' : null, nodes };
}
const push = (title = 'Hola', body = 'Ven pronto'): [string, any] => ['push', { title, body }];
const def = (graph: Grafo, extra: Record<string, any> = {}) => ({
  name: 'Mi flujo',
  triggerType: 'PASS_CREATED',
  graph,
  reentry: 'once',
  ...extra,
});

describe('flujos de antes (lista `steps`)', () => {
  it('se leen como grafo lineal con ids s0, s1… y el paso k de una inscripción vieja es s{k}', () => {
    const g = grafoDeLista([
      { type: 'SEND_SMS', body: 'a' },
      { type: 'WAIT', unit: 'days', amount: 2 },
      { type: 'SEND_PUSH', title: 't', body: 'b' },
    ]);
    expect(g.rootId).toBe('s0');
    expect(g.nodes.s0).toMatchObject({ type: 'sms', next: 's1' });
    expect(g.nodes.s1).toMatchObject({ type: 'wait', config: { amount: 2, unit: 'days' }, next: 's2' });
    expect(g.nodes.s2).toMatchObject({ type: 'push', next: null });
    expect(nodoActual({ currentNodeId: null, stepIndex: 2 })).toBe('s2');
    expect(grafoDelFlujo({ schemaVersion: 1, steps: [{ type: 'SEND_PUSH', title: 'a', body: 'b' }] }).rootId).toBe('s0');
  });
  it('un flujo v2 usa su grafo e ignora `steps`', () => {
    const g = lineal(push());
    expect(grafoDelFlujo({ schemaVersion: 2, graph: g, steps: [{ type: 'SEND_SMS' }] })).toEqual(g);
  });
});

describe('forma del grafo (para guardar un borrador)', () => {
  it('un borrador incompleto se puede guardar', () => {
    expect(problemasDeForma(lineal(['push', { title: '', body: '' }]))).toEqual([]);
  });
  it('conexión a un nodo que no existe', () => {
    const g = lineal(push());
    g.nodes.x0.next = 'fantasma';
    expect(problemasDeForma(g).map((p) => p.codigo)).toContain('conexion_invalida');
  });
  it('ciclo: un paso que vuelve a uno anterior', () => {
    const g = lineal(push(), ['wait', { amount: 1, unit: 'days' }]);
    g.nodes.x1.next = 'x0';
    expect(problemasDeForma(g).map((p) => p.codigo)).toContain('ciclo');
  });
  it('nodo desconectado', () => {
    const g = lineal(push());
    g.nodes.suelto = { id: 'suelto', type: 'push', config: {}, next: null };
    expect(problemasDeForma(g)).toContainEqual({ nodeId: 'suelto', codigo: 'desconectado' });
  });
  it('tipo inventado', () => {
    const g = lineal(['borrar_todo', {}]);
    expect(problemasDeForma(g).map((p) => p.codigo)).toContain('tipo_desconocido');
  });
});

describe('validación para activar', () => {
  it('flujo correcto → sin problemas', () => {
    expect(problemasParaActivar(def(lineal(['wait', { amount: 2, unit: 'days' }], push())), ctx)).toEqual([]);
  });
  it('sin disparador, sin acciones, disparador que no existe en Clubify', () => {
    expect(problemasParaActivar(def(lineal(), { triggerType: '' }), ctx).map((p) => p.codigo)).toEqual(
      expect.arrayContaining(['sin_disparador', 'sin_acciones']),
    );
    expect(problemasParaActivar(def(lineal(push()), { triggerType: 'GEO_ENTER' }), ctx).map((p) => p.codigo)).toContain(
      'disparador_no_disponible',
    );
  });
  it('push sin título o sin mensaje, y texto demasiado largo', () => {
    const cods = problemasParaActivar(def(lineal(['push', { title: '', body: '' }])), ctx).map((p) => p.codigo);
    expect(cods).toEqual(expect.arrayContaining(['push_sin_titulo', 'push_sin_mensaje']));
    const largo = problemasParaActivar(def(lineal(push('t', 'x'.repeat(181)))), ctx);
    expect(largo).toContainEqual({ nodeId: 'x0', campo: 'body', codigo: 'texto_largo', extra: { max: 180 } });
  });
  it('espera inválida: cero, unidad inventada, más de un año', () => {
    for (const config of [{ amount: 0, unit: 'days' }, { amount: 3, unit: 'siglos' }, { amount: 400, unit: 'days' }]) {
      const cods = problemasParaActivar(def(lineal(['wait', config], push())), ctx).map((p) => p.codigo);
      expect(cods).toContain('espera_invalida');
    }
  });
  it('condición incompleta: sin campo, operador que no va con el tipo, sin valor', () => {
    const cond = (config: any): Grafo => ({
      rootId: 'c',
      nodes: { c: { id: 'c', type: 'condition', config, yes: 'p', no: null }, p: { id: 'p', type: 'push', config: { title: 'a', body: 'b' }, next: null } },
    });
    expect(problemasParaActivar(def(cond({})), ctx).map((p) => p.codigo)).toContain('condicion_sin_campo');
    expect(problemasParaActivar(def(cond({ field: 'cupon_activo', op: 'gt' })), ctx).map((p) => p.codigo)).toContain(
      'condicion_sin_operador',
    );
    expect(problemasParaActivar(def(cond({ field: 'sellos_actuales', op: 'gt' })), ctx).map((p) => p.codigo)).toContain(
      'condicion_sin_valor',
    );
    expect(problemasParaActivar(def(cond({ field: 'sellos_actuales', op: 'gt', value: 3 })), ctx)).toEqual([]);
  });
  it('variable que no existe en el mensaje', () => {
    expect(variablesDesconocidas('Hola {{customerName}}, {{saldo}}')).toEqual(['saldo']);
    expect(problemasParaActivar(def(lineal(push('Hola {{apellido}}'))), ctx).map((p) => p.codigo)).toContain(
      'variable_desconocida',
    );
  });
  it('SMS: sin línea del negocio, o en un alta a la tarjeta (solo push)', () => {
    const g = lineal(['sms', { body: 'hola' }]);
    expect(problemasParaActivar(def(g, { triggerType: 'STAMP_ADDED' }), { ...ctx, smsDisponible: false }).map((p) => p.codigo)).toContain(
      'canal_no_disponible',
    );
    expect(problemasParaActivar(def(g), ctx).map((p) => p.codigo)).toContain('alta_solo_push');
  });
  it('inactividad necesita días válidos; el filtro de tarjeta tiene que ser del negocio', () => {
    expect(problemasParaActivar(def(lineal(push()), { triggerType: 'INACTIVITY' }), ctx).map((p) => p.codigo)).toContain(
      'dias_invalidos',
    );
    expect(problemasParaActivar(def(lineal(push()), { triggerType: 'INACTIVITY', triggerDays: 7 }), ctx)).toEqual([]);
    expect(
      problemasParaActivar(def(lineal(push()), { triggerConfig: { cardId: 'de-otro-negocio' } }), ctx).map((p) => p.codigo),
    ).toContain('tarjeta_ajena');
  });
});

describe('condiciones', () => {
  it('números', () => {
    expect(evaluarCondicion('gte', 7, 7)).toBe(true);
    expect(evaluarCondicion('lt', 2, 3)).toBe(true);
    expect(evaluarCondicion('neq', 2, 2)).toBe(false);
  });
  it('sin dato (nunca visitó): solo «está vacío» lo acepta', () => {
    expect(evaluarCondicion('empty', null)).toBe(true);
    expect(evaluarCondicion('gt', null, 0)).toBe(false);
    expect(evaluarCondicion('lt', null, 100)).toBe(false);
  });
  it('un operador desconocido nunca da verdadero', () => {
    expect(evaluarCondicion('contains_everything', 5, 1)).toBe(false);
  });
});

describe('horario de envío', () => {
  it('dentro de 8:00–21:00 sale ya; fuera, espera a las 8', () => {
    expect(msHastaHorario(10)).toBe(0);
    expect(msHastaHorario(3)).toBe(5 * 3_600_000);
    expect(msHastaHorario(22.5)).toBe(9.5 * 3_600_000);
  });
});

describe('plantillas', () => {
  it('las 8 plantillas generan grafos válidos de forma y las 7 con disparador se pueden activar', () => {
    expect(PLANTILLAS_FLUJO).toHaveLength(8);
    for (const p of PLANTILLAS_FLUJO) {
      const g = grafoDePlantilla(p, 'es', id);
      expect(problemasDeForma(g)).toEqual([]);
      expect(Object.keys(g.nodes)).toHaveLength(contarPasos(p));
      if (p.key === 'vacio') continue;
      const ps = problemasParaActivar(
        { name: p.nombre.es, triggerType: p.triggerType, triggerDays: p.triggerDays, graph: g, reentry: p.reentry },
        ctx,
      );
      expect(ps, p.key).toEqual([]);
    }
  });
  it('usar una plantilla dos veces da ids distintos (la plantilla no se comparte)', () => {
    const a = grafoDePlantilla(PLANTILLAS_FLUJO[0], 'es', id);
    const b = grafoDePlantilla(PLANTILLAS_FLUJO[0], 'es', id);
    expect(Object.keys(a.nodes).some((k) => k in b.nodes)).toBe(false);
  });
  it('en inglés para un negocio en inglés', () => {
    const g = grafoDePlantilla(PLANTILLAS_FLUJO[0], 'en', id);
    const textos = Object.values(g.nodes).map((x) => x.config.title).filter(Boolean);
    expect(textos[0]).toMatch(/Welcome/);
  });
});
