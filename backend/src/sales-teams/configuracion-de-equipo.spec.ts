import { describe, expect, it } from 'vitest';
import {
  CAMPOS_DEL_BANCO,
  CAMPOS_DEL_BANCO_POR_DEFECTO,
  MAX_ETIQUETA,
  MENSAJE_POR_DEFECTO,
  PESTANAS_DEL_BANCO,
  activoSegunEstado,
  estadoDeEquipo,
  leerAjustes,
  mensajeDeWhatsapp,
  normalizarCamposDelBanco,
  normalizarColor,
  normalizarEtiquetas,
} from './configuracion-de-equipo';

describe('estado del equipo', () => {
  it('desactivado es lo único que apaga isActive', () => {
    expect(activoSegunEstado('activo')).toBe(true);
    expect(activoSegunEstado('pausado')).toBe(true);
    expect(activoSegunEstado('desactivado')).toBe(false);
  });

  it('manda isActive: un equipo inactivo es desactivado aunque la columna diga otra cosa', () => {
    expect(estadoDeEquipo('activo', false)).toBe('desactivado');
    expect(estadoDeEquipo('pausado', true)).toBe('pausado');
    expect(estadoDeEquipo('desactivado', true)).toBe('activo');
    expect(estadoDeEquipo(null, true)).toBe('activo');
  });
});

describe('normalizarColor', () => {
  it('acepta #RRGGBB y lo pone en mayúsculas; vacío es sin color', () => {
    expect(normalizarColor(' #22c55e ')).toBe('#22C55E');
    expect(normalizarColor('')).toBeNull();
    expect(normalizarColor(null)).toBeNull();
  });

  it('rechaza lo que no es un color', () => {
    expect(normalizarColor('red')).toHaveProperty('error');
    expect(normalizarColor('#fff')).toHaveProperty('error');
    expect(normalizarColor('#22C55E;background:url(x)')).toHaveProperty('error');
  });
});

describe('mensajeDeWhatsapp', () => {
  it('rellena nombre, closer y equipo', () => {
    expect(mensajeDeWhatsapp('Hola {{nombre}}, soy {{ closer }} de {{EQUIPO}}', { nombre: 'Ana', closer: 'Luis', equipo: 'Norte' })).toBe(
      'Hola Ana, soy Luis de Norte',
    );
  });

  it('sin plantilla usa la de siempre, que no nombra ninguna marca', () => {
    const m = mensajeDeWhatsapp(null, { nombre: 'Ana', closer: 'Luis', equipo: 'Norte' });
    expect(m).toContain('Ana');
    expect(m).toContain('Norte');
    expect(MENSAJE_POR_DEFECTO.toLowerCase()).not.toContain('clubify');
    expect(MENSAJE_POR_DEFECTO.toLowerCase()).not.toContain('sellea');
  });

  it('sin nombre no deja «Hola ,»', () => {
    expect(mensajeDeWhatsapp('Hola {{nombre}}, ¿cómo estás?', {})).toBe('Hola, ¿cómo estás?');
  });

  it('un nombre con $& no se convierte en otra cosa', () => {
    expect(mensajeDeWhatsapp('Hola {{nombre}}', { nombre: 'A$&B' })).toBe('Hola A$&B');
  });
});

describe('la configuración del Banco, contra la referencia', () => {
  it('las pestañas llevan el icono y el texto de TeamClubify, en el orden del Banco y sin «Reagendada»', () => {
    expect(PESTANAS_DEL_BANCO.map((p) => `${p.icono} ${p.ayuda}`)).toEqual([
      '📥 Inicial (recién agendada)',
      '🕓 Con closer asignado',
      '🔁 En seguimiento',
      '🚫 No asistió',
      '✖️ Cancelada',
      '🏆 Ganada (venta cerrada)',
      '💔 Perdida',
    ]);
  });

  it('los campos van con los nombres y en el orden de la referencia; los que solo hay aquí, al final', () => {
    expect(CAMPOS_DEL_BANCO.map((c) => c.etiqueta)).toEqual([
      'WhatsApp',
      'Email',
      'Empresa',
      'Sitio web / Instagram',
      'Fuente del lead',
      'Lead Score',
      'Próxima acción',
      'Nota de seguimiento',
      'Closer asignado',
      'Duración',
      'Respuestas del formulario',
    ]);
  });

  it('las claves ya guardadas siguen valiendo aunque cambie el nombre que se enseña', () => {
    expect(normalizarCamposDelBanco(CAMPOS_DEL_BANCO_POR_DEFECTO)).toEqual([
      'whatsapp',
      'email',
      'empresa',
      'origen',
      'closer',
      'duracion',
    ]);
  });
});

describe('normalizarEtiquetas', () => {
  it('solo guarda lo que cambia, recortado', () => {
    expect(normalizarEtiquetas({ por_asignar: ' Nuevas ', por_confirmar: 'Por confirmar', seguimiento: '', raro: 'x' })).toEqual({
      por_asignar: 'Nuevas',
    });
    const largo = normalizarEtiquetas({ ganadas: 'x'.repeat(100) }) as Record<string, string>;
    expect(largo.ganadas).toHaveLength(MAX_ETIQUETA);
  });

  it('rechaza lo que no es un objeto de textos', () => {
    expect(normalizarEtiquetas([])).toHaveProperty('error');
    expect(normalizarEtiquetas({ ganadas: 3 })).toHaveProperty('error');
  });
});

describe('normalizarCamposDelBanco', () => {
  it('en el orden del catálogo y sin repetir', () => {
    expect(normalizarCamposDelBanco(['duracion', 'whatsapp', 'whatsapp'])).toEqual(['whatsapp', 'duracion']);
  });

  it('acepta los campos nuevos y los ordena como el catálogo', () => {
    expect(normalizarCamposDelBanco(['nota_seguimiento', 'closer', 'instagram', 'proxima_accion', 'puntaje'])).toEqual([
      'instagram',
      'puntaje',
      'proxima_accion',
      'nota_seguimiento',
      'closer',
    ]);
  });

  it('rechaza un campo que no existe', () => {
    expect(normalizarCamposDelBanco(['facturacion'])).toEqual({ error: '«facturacion» no es un campo del Banco' });
    expect(normalizarCamposDelBanco('whatsapp')).toHaveProperty('error');
    expect(normalizarCamposDelBanco([])).toEqual({ error: 'Marca al menos un dato para enseñar en el Banco' });
  });
});

describe('leerAjustes', () => {
  it('lo vacío o roto vuelve a lo de siempre, nunca a un Banco en blanco', () => {
    for (const roto of [null, 'basura', [], { camposDelBanco: [] }, { camposDelBanco: ['raro'] }]) {
      const a = leerAjustes(roto as never);
      expect(a.camposDelBanco).toEqual(CAMPOS_DEL_BANCO_POR_DEFECTO);
      expect(a.etiquetasDelBanco).toEqual({});
      expect(a.mensajeWhatsapp).toBeNull();
      expect(a.recibeDesconocidos).toBe(false);
    }
  });

  it('lee lo guardado bueno e ignora lo que sobra', () => {
    const a = leerAjustes({
      mensajeWhatsapp: ' Hola {{nombre}} ',
      etiquetasDelBanco: { ganadas: 'Cerradas' },
      camposDelBanco: ['respuestas', 'raro', 'whatsapp'],
    });
    expect(a).toEqual({
      mensajeWhatsapp: 'Hola {{nombre}}',
      etiquetasDelBanco: { ganadas: 'Cerradas' },
      camposDelBanco: ['whatsapp', 'respuestas'],
      recibeDesconocidos: false,
    });
  });

  it('lee los campos nuevos guardados, en el orden del catálogo', () => {
    expect(leerAjustes({ camposDelBanco: ['proxima_accion', 'instagram'] }).camposDelBanco).toEqual([
      'instagram',
      'proxima_accion',
    ]);
  });
});
