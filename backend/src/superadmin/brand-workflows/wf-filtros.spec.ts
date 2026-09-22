import { describe, it, expect } from 'vitest';
import {
  cumpleCondicion,
  disparadoresDe,
  disparadoresParaGuardar,
  disparadorQueCasa,
  escuchaEl,
  etiquetaDeDisparador,
  evalWF,
  normalizarDisparadores,
  OPERADORES,
  operadoresDe,
  valoresDe,
  type WFCondition,
} from './wf-filtros.util';

/**
 * Los filtros de los disparadores y los varios disparadores por flujo
 * (2026-09-22), compartidos por el constructor de contactos y el de negocios.
 *
 * Por qué estas pruebas: esto decide A QUIÉN le llega un mensaje. Lo que puede
 * costar dinero o credibilidad es:
 *   · que un filtro que no se sabe leer deje entrar a todo el mundo (pasaba:
 *     un operador desconocido devolvía `true`),
 *   · que «contiene» con varias frases se parta por comas y «hola» case con todo,
 *   · que un flujo publicado antes de la lista de disparadores deje de arrancar,
 *   · y que con varios disparadores se exija que casen TODOS (o que baste un
 *     filtro) en vez de O entre disparadores e Y entre filtros.
 */

const cumple = (op: string, campo: string, value?: string | string[]) =>
  cumpleCondicion({ field: 'x', op, value }, { x: campo });

describe('los 12 operadores', () => {
  it('son exactamente los de TeamClubify', () => {
    expect(OPERADORES.map((o) => o.value)).toEqual([
      'eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with',
      'gt', 'lt', 'filled', 'empty', 'has_tag', 'not_tag',
    ]);
  });

  it('«es» y «no es» comparan sin mayúsculas ni espacios', () => {
    expect(cumple('eq', ' Pro ', 'pro')).toBe(true);
    expect(cumple('eq', 'Pro', 'Premium')).toBe(false);
    expect(cumple('neq', 'Pro', 'Premium')).toBe(true);
    expect(cumple('neq', 'Pro', 'PRO')).toBe(false);
  });

  it('«contiene» casa si aparece CUALQUIERA de los valores', () => {
    expect(cumple('contains', 'Quiero el precio del plan', ['descuento', 'precio'])).toBe(true);
    expect(cumple('contains', 'Quiero el precio del plan', ['descuento', 'cupón'])).toBe(false);
  });

  it('«contiene» sigue aceptando el texto suelto de antes', () => {
    expect(cumple('contains', 'Hola, me interesa', 'interesa')).toBe(true);
  });

  it('una frase con coma NO se parte: «hola» sola no casa con todo', () => {
    // Si se partiera por comas, «Hola, me interesa saber más» se convertiría
    // en «hola» + «me interesa saber más», y cualquier «hola» entraría.
    expect(cumple('contains', 'hola buenas', ['Hola, me interesa saber más'])).toBe(false);
    expect(cumple('contains', 'hola buenas', 'Hola, me interesa saber más')).toBe(false);
  });

  it('«contiene» sin valores sigue casando, como antes (un «Si / No» publicado no cambia de rama)', () => {
    expect(cumple('contains', 'lo que sea', [])).toBe(true);
    expect(cumple('contains', 'lo que sea', '')).toBe(true);
  });

  it('«no contiene» descarta si aparece cualquiera', () => {
    expect(cumple('not_contains', 'no me interesa', ['interesa', 'baja'])).toBe(false);
    expect(cumple('not_contains', 'cuánto cuesta', ['interesa', 'baja'])).toBe(true);
  });

  it('«empieza con» y «termina con»', () => {
    expect(cumple('starts_with', 'Restaurante Wok', 'resta')).toBe(true);
    expect(cumple('starts_with', 'Restaurante Wok', 'wok')).toBe(false);
    expect(cumple('ends_with', 'ana@sellea.com', '@sellea.com')).toBe(true);
    expect(cumple('ends_with', 'ana@gmail.com', '@sellea.com')).toBe(false);
  });

  it('«mayor que» y «menor que» son numéricos, no alfabéticos', () => {
    // Alfabéticamente «9» > «10»; numéricamente no.
    expect(cumple('gt', '10', '9')).toBe(true);
    expect(cumple('lt', '9', '10')).toBe(true);
    expect(cumple('gt', '9', '10')).toBe(false);
    expect(cumple('gt', '10,5', '10')).toBe(true);
  });

  it('un número que no es número no deja entrar a nadie', () => {
    expect(cumple('gt', 'abc', '1')).toBe(false);
    expect(cumple('lt', '5', 'abc')).toBe(false);
    expect(cumple('gt', '', '0')).toBe(false);
  });

  it('«tiene valor» y «está vacío»', () => {
    expect(cumple('filled', 'algo')).toBe(true);
    expect(cumple('filled', '  ')).toBe(false);
    expect(cumple('empty', '')).toBe(true);
    expect(cumple('empty', 'algo')).toBe(false);
  });

  it('«tiene etiqueta» mira las etiquetas, sin mayúsculas ni tildes', () => {
    const ctx = { tags: 'VIP, Bogotá, medellin' };
    expect(cumpleCondicion({ field: 'tags', op: 'has_tag', value: ['vip'] }, ctx)).toBe(true);
    // La tilde puede estar en cualquiera de los dos lados: en la etiqueta del
    // contacto o en la que se escribió en el filtro.
    expect(cumpleCondicion({ field: 'tags', op: 'has_tag', value: ['bogota'] }, ctx)).toBe(true);
    expect(cumpleCondicion({ field: 'tags', op: 'has_tag', value: ['Medellín'] }, ctx)).toBe(true);
    expect(cumpleCondicion({ field: 'tags', op: 'has_tag', value: ['newsletter'] }, ctx)).toBe(false);
  });

  it('«tiene etiqueta» es etiqueta COMPLETA, no un trozo', () => {
    expect(cumpleCondicion({ field: 'tags', op: 'has_tag', value: 'cliente' }, { tags: 'cliente-vip' })).toBe(false);
  });

  it('«tiene etiqueta» sin decir cuál no deja entrar a nadie', () => {
    expect(cumpleCondicion({ field: 'tags', op: 'has_tag', value: [] }, { tags: '' })).toBe(false);
    expect(cumpleCondicion({ field: 'tags', op: 'has_tag', value: [] }, { tags: 'vip' })).toBe(false);
  });

  it('«no tiene etiqueta»', () => {
    const ctx = { tags: 'vip, bogota' };
    expect(cumpleCondicion({ field: 'tags', op: 'not_tag', value: ['baja'] }, ctx)).toBe(true);
    expect(cumpleCondicion({ field: 'tags', op: 'not_tag', value: ['VIP'] }, ctx)).toBe(false);
  });

  it('los de negocios no traen los de etiqueta: un negocio no tiene etiquetas', () => {
    expect(operadoresDe(false).map((o) => o.value)).not.toContain('has_tag');
    expect(operadoresDe(false).map((o) => o.value)).not.toContain('not_tag');
    expect(operadoresDe(false)).toHaveLength(10);
    expect(operadoresDe(true)).toHaveLength(12);
  });
});

describe('falla CERRADO', () => {
  // El defecto de antes: `default: return true`. Un filtro con un operador mal
  // escrito o de otra versión dejaba entrar a TODOS.
  it('un operador desconocido NO deja pasar', () => {
    for (const op of ['equals', 'EQ', '', 'contiene', 'regex', 'undefined']) {
      expect(cumple(op, 'lo que sea', 'lo que sea'), op).toBe(false);
    }
  });

  it('sin operador tampoco', () => {
    expect(cumpleCondicion({ field: 'x' } as WFCondition, { x: 'algo' })).toBe(false);
  });

  it('un filtro desconocido tumba el disparador entero aunque los demás casen', () => {
    const filtros = [
      { field: 'plan', op: 'eq', value: 'pro' },
      { field: 'plan', op: 'inventado', value: 'pro' },
    ];
    expect(evalWF(filtros, { plan: 'Pro' }, 'all')).toBe(false);
  });
});

describe('valores de un filtro', () => {
  it('acepta lista y texto, sin vacíos y en minúsculas', () => {
    expect(valoresDe([' Hola ', '', 'SÍ'])).toEqual(['hola', 'sí']);
    expect(valoresDe('uno\ndos\n\n')).toEqual(['uno', 'dos']);
    expect(valoresDe(undefined)).toEqual([]);
  });
});

describe('la lista de disparadores de un flujo', () => {
  it('un flujo de ANTES (lista vacía) sigue leyendo su disparador de siempre', () => {
    const wf = { trigger: { type: 'tag_added', tag: 'vip' }, triggers: [] };
    expect(disparadoresDe(wf)).toEqual([{ type: 'tag_added', tag: 'vip' }]);
    expect(escuchaEl(wf, 'tag_added')).toBe(true);
  });

  it('sin la columna nueva (undefined) también', () => {
    expect(disparadoresDe({ trigger: { type: 'contact_created' } })).toEqual([{ type: 'contact_created' }]);
  });

  it('si hay lista, MANDA la lista: `trigger` ya no se mira', () => {
    const wf = { trigger: { type: 'contact_created' }, triggers: [{ type: 'tag_added' }, { type: 'email_reply' }] };
    expect(disparadoresDe(wf).map((t) => t.type)).toEqual(['tag_added', 'email_reply']);
    expect(escuchaEl(wf, 'contact_created')).toBe(false);
    expect(escuchaEl(wf, 'email_reply')).toBe(true);
  });

  it('un flujo sin disparador no escucha nada', () => {
    expect(disparadoresDe({ trigger: {} })).toEqual([]);
    expect(disparadoresDe({ trigger: null, triggers: null })).toEqual([]);
  });
});

describe('O entre disparadores, Y entre filtros', () => {
  const lista = [
    { type: 'email_reply', filters: [{ field: 'respuesta', op: 'contains', value: ['precio'] }] },
    {
      type: 'email_reply',
      filters: [
        { field: 'respuesta', op: 'contains', value: ['sí'] },
        { field: 'tags', op: 'has_tag', value: ['vip'] },
      ],
    },
    { type: 'tag_added' },
  ];

  it('basta con que case UNO de los disparadores', () => {
    const r = disparadorQueCasa(lista, 'email_reply', { respuesta: 'sí, quiero', tags: 'vip' });
    expect(r?.indice).toBe(1);
  });

  it('dentro de un disparador se exigen TODOS sus filtros', () => {
    // Dice «sí» pero no es vip: el segundo no casa, y el primero tampoco.
    expect(disparadorQueCasa(lista, 'email_reply', { respuesta: 'sí, quiero', tags: 'bogota' })).toBeNull();
  });

  it('si casan varios gana el PRIMERO de la lista', () => {
    const r = disparadorQueCasa(lista, 'email_reply', { respuesta: 'sí, el precio', tags: 'vip' });
    expect(r?.indice).toBe(0);
  });

  it('un disparador de otro tipo no cuenta aunque no tenga filtros', () => {
    expect(disparadorQueCasa(lista, 'contact_created', {})).toBeNull();
    expect(disparadorQueCasa(lista, 'tag_added', {})?.indice).toBe(2);
  });

  it('lo propio de cada tipo (`cumple`) se exige además de los filtros', () => {
    const conEtiqueta = [{ type: 'tag_added', tag: 'vip' }, { type: 'tag_added', tag: 'cliente' }];
    const r = disparadorQueCasa(conEtiqueta, 'tag_added', {}, (t) => t.tag === 'cliente');
    expect(r?.indice).toBe(1);
  });
});

describe('el nombre del disparador por el que entró', () => {
  const cat = [{ key: 'tag_added', label: 'Etiqueta agregada' }, { key: 'contact_created', label: 'Contacto nuevo' }];
  it('lleva la etiqueta si la tiene, o el número si no', () => {
    expect(etiquetaDeDisparador({ type: 'tag_added', tag: 'vip' }, 0, cat)).toBe('Etiqueta agregada · vip');
    expect(etiquetaDeDisparador({ type: 'contact_created' }, 1, cat)).toBe('Contacto nuevo #2');
    expect(etiquetaDeDisparador({ type: 'contact_created', name: 'Altas de la web' }, 1, cat)).toBe('Altas de la web');
  });
});

describe('lo que se guarda desde la pantalla', () => {
  const ops = OPERADORES.map((o) => o.value);

  it('`trigger` es SIEMPRE el primero de la lista (lo sigue leyendo lo de antes)', () => {
    const r = disparadoresParaGuardar({ triggers: [{ type: 'tag_added', tag: 'vip' }, { type: 'email_reply' }] }, ops);
    expect(r).toEqual({
      ok: true,
      data: {
        trigger: { type: 'tag_added', tag: 'vip' },
        triggers: [{ type: 'tag_added', tag: 'vip' }, { type: 'email_reply' }],
      },
    });
  });

  it('una pantalla vieja que solo manda `trigger` deja una lista de uno', () => {
    const r = disparadoresParaGuardar({ trigger: { type: 'contact_created' } }, ops);
    expect(r).toEqual({ ok: true, data: { trigger: { type: 'contact_created' }, triggers: [{ type: 'contact_created' }] } });
  });

  it('sin disparadores en el cuerpo (p. ej. solo publicar) no se toca nada', () => {
    expect(disparadoresParaGuardar({}, ops)).toEqual({ ok: true, data: null });
  });

  it('rechaza un operador desconocido al GUARDAR, no cuando ya no llega nada', () => {
    const r = normalizarDisparadores([{ type: 'email_reply', filters: [{ field: 'respuesta', op: 'regex', value: 'x' }] }], ops);
    expect(r.ok).toBe(false);
  });

  it('los de etiqueta no valen en negocios', () => {
    const r = normalizarDisparadores([{ type: 'business_created', filters: [{ field: 'tags', op: 'has_tag', value: ['x'] }] }], operadoresDe(false).map((o) => o.value));
    expect(r.ok).toBe(false);
  });

  it('rechaza un disparador sin tipo y una lista vacía', () => {
    expect(normalizarDisparadores([{ tag: 'vip' }], ops).ok).toBe(false);
    expect(normalizarDisparadores([], ops).ok).toBe(false);
    expect(normalizarDisparadores('no es lista', ops).ok).toBe(false);
  });

  it('NO rechaza un tipo que el catálogo ya no trae: el flujo viejo tiene que poder guardarse', () => {
    expect(normalizarDisparadores([{ type: 'tipo_de_otra_version' }], ops).ok).toBe(true);
  });

  it('limpia los valores de la lista y conserva los ajustes planos del tipo', () => {
    const r = normalizarDisparadores(
      [{ type: 'subscription_expiring', daysBefore: 7, raro: { anidado: true }, filters: [{ field: 'plan', op: 'contains', value: [' pro ', ''] }] }],
      ops,
    );
    expect(r).toEqual({
      ok: true,
      lista: [{ type: 'subscription_expiring', daysBefore: 7, filters: [{ field: 'plan', op: 'contains', value: ['pro'] }] }],
    });
  });
});
