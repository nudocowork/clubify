import { describe, it, expect } from 'vitest';
import { formularioPorDefecto, normalizarFormulario, revisarRegistro } from './formulario-de-registro';

describe('formulario de registro', () => {
  it('sin nada guardado: Sellea exige correo y cumpleaños, el resto no', () => {
    expect(normalizarFormulario(null, 'sellea')).toEqual({ email: 'obligatorio', cumpleanos: 'obligatorio', extras: [] });
    expect(normalizarFormulario(undefined, 'clubify')).toEqual(formularioPorDefecto('clubify'));
    expect(formularioPorDefecto('clubify').email).toBe('opcional');
  });

  it('lo guardado manda sobre la marca', () => {
    const f = normalizarFormulario({ email: 'oculto', cumpleanos: 'opcional' }, 'sellea');
    expect(f.email).toBe('oculto');
    expect(f.cumpleanos).toBe('opcional');
  });

  it('limpia casillas: sin etiqueta fuera, ids repetidos, lista vacía pasa a texto', () => {
    const f = normalizarFormulario(
      {
        email: 'raro',
        extras: [
          { id: 'a', etiqueta: '  Cédula ', tipo: 'numero', obligatorio: true },
          { id: 'a', etiqueta: 'Ciudad', tipo: 'texto' },
          { etiqueta: '' },
          { id: 'b', etiqueta: '¿Cómo nos conociste?', tipo: 'opciones', opciones: ['Instagram', 'Instagram', ' '] },
          { id: 'c', etiqueta: 'Talla', tipo: 'opciones', opciones: [] },
        ],
      },
      'clubify',
    );
    expect(f.email).toBe('opcional');
    expect(f.extras.map((e) => e.etiqueta)).toEqual(['Cédula', 'Ciudad', '¿Cómo nos conociste?', 'Talla']);
    expect(new Set(f.extras.map((e) => e.id)).size).toBe(4);
    expect(f.extras[2].opciones).toEqual(['Instagram']);
    expect(f.extras[3].tipo).toBe('texto');
    expect(f.extras[1].obligatorio).toBe(false);
  });

  it('exige lo obligatorio y guarda las respuestas con su etiqueta', () => {
    const f = normalizarFormulario(
      {
        email: 'obligatorio',
        cumpleanos: 'opcional',
        extras: [
          { id: 'ced', etiqueta: 'Cédula', tipo: 'numero', obligatorio: true },
          { id: 'src', etiqueta: 'Fuente', tipo: 'opciones', opciones: ['Instagram', 'Amigo'] },
        ],
      },
      'clubify',
    );
    expect(revisarRegistro(f, {})).toEqual({ error: 'El correo electrónico es obligatorio' });
    expect(revisarRegistro(f, { email: 'a@b.co' })).toEqual({ error: 'Completa «Cédula»' });
    expect(revisarRegistro(f, { email: 'a@b.co', extras: { ced: 'abc' } })).toEqual({ error: '«Cédula» debe ser un número' });
    expect(revisarRegistro(f, { email: 'a@b.co', extras: { ced: '123', src: 'TikTok' } })).toEqual({
      error: 'Elige una opción de «Fuente»',
    });
    expect(revisarRegistro(f, { email: 'a@b.co', extras: { ced: 123, src: 'Amigo' } })).toEqual({
      datos: { ced: { etiqueta: 'Cédula', valor: '123' }, src: { etiqueta: 'Fuente', valor: 'Amigo' } },
    });
  });

  it('cumpleaños obligatorio', () => {
    const f = normalizarFormulario({ cumpleanos: 'obligatorio' }, 'clubify');
    expect(revisarRegistro(f, {})).toEqual({ error: 'La fecha de cumpleaños es obligatoria' });
    expect(revisarRegistro(f, { birthday: '2000-05-04' })).toEqual({ datos: {} });
  });
});
