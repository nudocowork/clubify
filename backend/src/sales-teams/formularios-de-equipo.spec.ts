import { describe, expect, it } from 'vitest';
import {
  CAMPOS_DE_AGENDA,
  camposGuardados,
  camposParaElPublico,
  formularioDeAgendaDe,
  pideDatoDeContacto,
  resumenDeRespuestas,
  MAX_CAMPOS,
  camposQueFaltan,
  camposVisibles,
  condicionCumplida,
  datosDelLead,
  limpiarRespuestas,
  normalizarCampos,
  puntajeDelFormulario,
  slugDeFormulario,
  type CampoDeFormulario,
} from './formularios-de-equipo';

const CAMPOS: CampoDeFormulario[] = [
  { id: 'f1', key: 'nombre', type: 'short_text', label: 'Nombre', required: true, maps_to: 'first_name' },
  { id: 'f2', key: 'apellidos', type: 'short_text', label: 'Apellidos', maps_to: 'last_name' },
  {
    id: 'f3',
    key: 'invertir',
    type: 'radio',
    label: '¿Invertir?',
    required: true,
    options: [
      { value: 'si', label: 'Sí', score: 30 },
      { value: 'no', label: 'No' },
    ],
  },
  {
    id: 'f4',
    key: 'motivo',
    type: 'long_text',
    label: '¿Por qué no?',
    required: true,
    condition: { when: 'invertir', op: 'eq', value: 'no' },
  },
  {
    id: 'f5',
    key: 'detalle',
    type: 'short_text',
    label: 'Detalle del motivo',
    required: true,
    condition: { when: 'motivo', op: 'filled' },
  },
];

describe('normalizarCampos', () => {
  it('acepta un formulario válido y quita lo que sobra', () => {
    const r = normalizarCampos([{ id: 'a', key: 'nombre', type: 'short_text', label: ' Nombre ', raro: 'x' }]);
    expect(r).toEqual([{ id: 'a', key: 'nombre', type: 'short_text', label: 'Nombre' }]);
  });

  it('rechaza lo que no es una lista, tipos inventados y claves repetidas', () => {
    expect(normalizarCampos({})).toHaveProperty('error');
    expect(normalizarCampos([{ key: 'a', type: 'firma', label: 'A' }])).toHaveProperty('error');
    expect(
      normalizarCampos([
        { key: 'a', type: 'short_text', label: 'A' },
        { key: 'a', type: 'short_text', label: 'B' },
      ]),
    ).toEqual({ error: 'Dos preguntas usan la misma clave «a»' });
  });

  it('las preguntas de elegir necesitan opciones únicas', () => {
    expect(normalizarCampos([{ key: 'a', type: 'select', label: 'A', options: [] }])).toHaveProperty('error');
    expect(
      normalizarCampos([{ key: 'a', type: 'select', label: 'A', options: [{ value: 'x' }, { value: 'x' }] }]),
    ).toEqual({ error: '«A» repite la opción «x»' });
  });

  it('no admite claves del prototipo', () => {
    for (const key of ['__proto__', 'constructor', 'tostring_ok']) {
      const r = normalizarCampos([{ key, type: 'short_text', label: 'A' }]);
      if (key === 'tostring_ok') expect(Array.isArray(r)).toBe(true);
      else expect(r).toEqual({ error: `«${key}» es una clave reservada: elige otra` });
    }
  });

  it('una condición solo puede depender de una pregunta anterior', () => {
    expect(
      normalizarCampos([
        { key: 'a', type: 'short_text', label: 'A', condition: { when: 'b', op: 'filled' } },
        { key: 'b', type: 'short_text', label: 'B' },
      ]),
    ).toEqual({ error: '«A» depende de una pregunta que no está antes que ella' });
  });

  it('pone tope de preguntas y de puntaje', () => {
    const muchas = Array.from({ length: MAX_CAMPOS + 1 }, (_, i) => ({ key: `k${i}`, type: 'short_text', label: 'X' }));
    expect(normalizarCampos(muchas)).toHaveProperty('error');
    const r = normalizarCampos([{ key: 'a', type: 'short_text', label: 'A', score: 500 }]) as CampoDeFormulario[];
    expect(r[0].score).toBe(100);
  });
});

describe('condicionCumplida', () => {
  it('eq, neq, in y filled, con texto y con listas', () => {
    expect(condicionCumplida({ when: 'x', op: 'eq', value: 'si' }, { x: 'si' })).toBe(true);
    expect(condicionCumplida({ when: 'x', op: 'neq', value: 'si' }, { x: 'no' })).toBe(true);
    expect(condicionCumplida({ when: 'x', op: 'in', value: ['a', 'b'] }, { x: ['c', 'b'] })).toBe(true);
    expect(condicionCumplida({ when: 'x', op: 'filled' }, { x: '  ' })).toBe(false);
    expect(condicionCumplida({ when: 'x', op: 'filled' }, { x: false })).toBe(false);
    expect(condicionCumplida(null, {})).toBe(true);
  });
});

describe('camposVisibles y camposQueFaltan', () => {
  it('las condicionales solo aparecen cuando toca', () => {
    expect(camposVisibles(CAMPOS, { invertir: 'si' }).map((c) => c.key)).toEqual(['nombre', 'apellidos', 'invertir']);
    expect(camposVisibles(CAMPOS, { invertir: 'no' }).map((c) => c.key)).toContain('motivo');
  });

  it('en cascada: si la pregunta de la que dependen se oculta, sus dependientes también', () => {
    // «detalle» depende de «motivo», que depende de «invertir = no». Con «sí»,
    // una respuesta vieja a «motivo» no puede seguir mostrando «detalle».
    const visibles = camposVisibles(CAMPOS, { invertir: 'si', motivo: 'viejo' }).map((c) => c.key);
    expect(visibles).not.toContain('motivo');
    expect(visibles).not.toContain('detalle');
  });

  it('solo faltan las obligatorias que se ven', () => {
    expect(camposQueFaltan(CAMPOS, { nombre: 'Ana', invertir: 'si' })).toEqual([]);
    expect(camposQueFaltan(CAMPOS, { nombre: 'Ana', invertir: 'no' })).toEqual(['motivo']);
  });
});

describe('limpiarRespuestas', () => {
  it('se queda solo con las claves del formulario y las visibles', () => {
    const r = limpiarRespuestas(CAMPOS, { nombre: ' Ana ', invertir: 'si', motivo: 'no se ve', intruso: 'x' });
    expect(r).toEqual({ nombre: 'Ana', apellidos: null, invertir: 'si' });
  });

  it('un WhatsApp sin dígitos suficientes no se guarda', () => {
    const campos: CampoDeFormulario[] = [{ id: 'w', key: 'w', type: 'whatsapp', label: 'W', required: true }];
    expect(limpiarRespuestas(campos, { w: 'no tengo' }).w).toBeNull();
    expect(camposQueFaltan(campos, limpiarRespuestas(campos, { w: '12' }))).toEqual(['w']);
    expect(limpiarRespuestas(campos, { w: '+57 300 111 2233' }).w).toBe('+57 300 111 2233');
  });

  it('un correo sin @ no cuenta como respuesta', () => {
    const campos: CampoDeFormulario[] = [{ id: 'e', key: 'e', type: 'email', label: 'E', required: true }];
    expect(camposQueFaltan(campos, limpiarRespuestas(campos, { e: 'hola' }))).toEqual(['e']);
  });

  it('una opción que no existe no se guarda', () => {
    expect(limpiarRespuestas(CAMPOS, { invertir: 'quizas' }).invertir).toBeNull();
  });

  it('cada tipo con su forma', () => {
    const campos: CampoDeFormulario[] = [
      { id: '1', key: 'n', type: 'number', label: 'N' },
      { id: '2', key: 'e', type: 'email', label: 'E' },
      { id: '3', key: 'd', type: 'date', label: 'D' },
      { id: '4', key: 't', type: 'time', label: 'T' },
      { id: '5', key: 'c', type: 'checkbox', label: 'C' },
      { id: '6', key: 'm', type: 'multiselect', label: 'M', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    ];
    expect(
      limpiarRespuestas(campos, { n: 'doce', e: ' ANA@X.CO ', d: '14/09/2026', t: '25:00', c: 'on', m: ['a', 'z', 'a'] }),
    ).toEqual({ n: null, e: 'ana@x.co', d: null, t: null, c: true, m: ['a'] });
  });
});

describe('datosDelLead', () => {
  it('junta nombre y apellidos, y pasa lo que tiene destino', () => {
    const campos: CampoDeFormulario[] = [
      ...CAMPOS,
      { id: 'w', key: 'wa', type: 'whatsapp', label: 'WhatsApp', maps_to: 'whatsapp' },
      { id: 'i', key: 'ig', type: 'instagram', label: 'Instagram', maps_to: 'instagram' },
    ];
    expect(datosDelLead(campos, { nombre: 'Ana', apellidos: 'Ruiz', wa: '+57 300 111 2233', ig: '@ana' })).toEqual({
      name: 'Ana Ruiz',
      phone: '+57 300 111 2233',
      instagram: '@ana',
    });
  });

  it('un teléfono o un correo que no lo parecen no pasan al lead', () => {
    const campos: CampoDeFormulario[] = [
      { id: 'w', key: 'wa', type: 'short_text', label: 'WhatsApp', maps_to: 'whatsapp' },
      { id: 'e', key: 'mail', type: 'short_text', label: 'Correo', maps_to: 'email' },
    ];
    expect(datosDelLead(campos, { wa: 'no tengo', mail: 'hola' })).toEqual({});
    expect(datosDelLead(campos, { wa: '300 111 2233', mail: 'ANA@X.CO' })).toEqual({ phone: '300 111 2233', email: 'ana@x.co' });
  });
});

describe('puntajeDelFormulario', () => {
  it('suma por opción y pone tope 100', () => {
    expect(puntajeDelFormulario(CAMPOS, { invertir: 'si' })).toBe(30);
    const muchos: CampoDeFormulario[] = [
      { id: '1', key: 'a', type: 'short_text', label: 'A', score: 80 },
      { id: '2', key: 'b', type: 'short_text', label: 'B', score: 80 },
    ];
    expect(puntajeDelFormulario(muchos, { a: 'x', b: 'y' })).toBe(100);
  });
});

describe('slugDeFormulario', () => {
  it('minúsculas, sin tildes y con guiones', () => {
    expect(slugDeFormulario('Reunión estratégica: Sellea!')).toBe('reunion-estrategica-sellea');
    expect(slugDeFormulario('   ')).toBe('formulario');
  });
});

describe('CAMPOS_DE_AGENDA', () => {
  it('la plantilla pasa su propia limpieza sin perder preguntas', () => {
    const r = normalizarCampos(CAMPOS_DE_AGENDA);
    expect(Array.isArray(r)).toBe(true);
    expect((r as CampoDeFormulario[]).length).toBe(CAMPOS_DE_AGENDA.length);
  });
});

describe('resumenDeRespuestas', () => {
  it('una línea por respuesta, con la etiqueta de la opción y sin las vacías', () => {
    expect(resumenDeRespuestas(CAMPOS, { nombre: 'Ana', invertir: 'no', motivo: 'Caro' })).toBe(
      'Nombre: Ana\n¿Invertir?: No\n¿Por qué no?: Caro',
    );
  });

  it('recorta lo largo', () => {
    const r = resumenDeRespuestas(CAMPOS, { nombre: 'x'.repeat(50) }, 20);
    expect(r).toHaveLength(20);
  });
});

describe('formularioDeAgendaDe y camposGuardados', () => {
  it('lee el formulario elegido y aguanta JSON raro', () => {
    expect(formularioDeAgendaDe({ formularioId: 'f1' })).toBe('f1');
    expect(formularioDeAgendaDe({ formularioId: '' })).toBeNull();
    expect(formularioDeAgendaDe(null)).toBeNull();
    expect(formularioDeAgendaDe([1, 2] as never)).toBeNull();
  });

  it('lo guardado roto se lee como un formulario vacío, no como un error', () => {
    expect(camposGuardados('basura')).toEqual([]);
    expect(camposGuardados([{ key: 'a', type: 'short_text', label: 'A' }])).toHaveLength(1);
  });
});

describe('pideDatoDeContacto', () => {
  it('la plantilla de agenda y un nombre obligatorio lo cumplen', () => {
    expect(pideDatoDeContacto(CAMPOS_DE_AGENDA)).toBe(true);
    expect(pideDatoDeContacto(CAMPOS)).toBe(true);
  });

  it('no vale una pregunta opcional, condicional o de casilla', () => {
    expect(pideDatoDeContacto([{ id: '1', key: 'n', type: 'short_text', label: 'N', maps_to: 'first_name' }])).toBe(false);
    expect(
      pideDatoDeContacto([
        { id: '1', key: 'a', type: 'short_text', label: 'A' },
        {
          id: '2',
          key: 'w',
          type: 'whatsapp',
          label: 'W',
          required: true,
          maps_to: 'whatsapp',
          condition: { when: 'a', op: 'filled' },
        },
      ]),
    ).toBe(false);
    expect(pideDatoDeContacto([{ id: '1', key: 'c', type: 'checkbox', label: 'C', required: true, maps_to: 'email' }])).toBe(
      false,
    );
    expect(pideDatoDeContacto([{ id: '1', key: 'e', type: 'short_text', label: 'E', required: true, maps_to: 'company' }])).toBe(
      false,
    );
  });

  it('WhatsApp y correo solo cuentan con su tipo de pregunta', () => {
    expect(pideDatoDeContacto([{ id: '1', key: 'w', type: 'short_text', label: 'W', required: true, maps_to: 'whatsapp' }])).toBe(
      false,
    );
    expect(pideDatoDeContacto([{ id: '1', key: 'w', type: 'whatsapp', label: 'W', required: true, maps_to: 'whatsapp' }])).toBe(true);
    expect(pideDatoDeContacto([{ id: '1', key: 'e', type: 'email', label: 'E', required: true, maps_to: 'email' }])).toBe(true);
  });
});

describe('camposParaElPublico', () => {
  it('quita puntajes y destinos, y deja lo que la página necesita', () => {
    const r = camposParaElPublico(CAMPOS);
    expect(JSON.stringify(r)).not.toContain('score');
    expect(JSON.stringify(r)).not.toContain('maps_to');
    expect(r[2].options).toEqual([
      { value: 'si', label: 'Sí' },
      { value: 'no', label: 'No' },
    ]);
    expect(r[3].condition).toEqual({ when: 'invertir', op: 'eq', value: 'no' });
    expect(r[0].required).toBe(true);
  });
});
