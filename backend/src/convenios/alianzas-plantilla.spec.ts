import { describe, it, expect } from 'vitest';
import {
  cambiosDelDiseno,
  colorValido,
  datosDeLaPlantilla,
  textoPorDefecto,
  tituloPorDefecto,
} from './alianzas-plantilla';

/**
 * Importa el MÓDULO REAL, no una copia. Ver la nota de `alianzas-estado.spec`.
 */

const NEGOCIO = {
  brandName: 'Café Central',
  primaryColor: '#111827',
  secondaryColor: '#6B7280',
  logoUrl: 'https://cdn/negocio.png',
};

const ALIANZA = { id: 'c1', name: 'Ecopetrol', logoUrl: 'https://cdn/eco.png' };

describe('colorValido', () => {
  it('acepta un hex de 6 dígitos y lo normaliza a mayúsculas', () => {
    expect(colorValido('#0a1b2c')).toBe('#0A1B2C');
    expect(colorValido('  #FFFFFF  ')).toBe('#FFFFFF');
  });

  it('descarta lo que no lo sea, en vez de fallar', () => {
    // Llega de un input de color y de pegados a mano: un valor raro no debe
    // impedir guardar el resto del diseño.
    for (const malo of ['#FFF', 'rojo', '', '#12345', '#1234567', 'FFFFFF', null, 7]) {
      expect(colorValido(malo)).toBeUndefined();
    }
  });
});

describe('datosDeLaPlantilla', () => {
  it('usa los colores DEL NEGOCIO, no el verde de la plataforma', () => {
    const d = datosDeLaPlantilla('t1', ALIANZA, NEGOCIO);
    expect(d.primaryColor).toBe('#111827');
    expect(d.secondaryColor).toBe('#6B7280');
    expect(d.primaryColor).not.toBe('#22C55E');
  });

  it('el logo del ALIADO manda; el del negocio es el respaldo', () => {
    expect(datosDeLaPlantilla('t1', ALIANZA, NEGOCIO).logoUrl).toBe(
      'https://cdn/eco.png',
    );
    expect(
      datosDeLaPlantilla('t1', { ...ALIANZA, logoUrl: null }, NEGOCIO).logoUrl,
    ).toBe('https://cdn/negocio.png');
    // Sin ninguno de los dos: null. Nunca un logo de la plataforma.
    expect(
      datosDeLaPlantilla(
        't1',
        { ...ALIANZA, logoUrl: null },
        { ...NEGOCIO, logoUrl: null },
      ).logoUrl,
    ).toBeNull();
  });

  it('pide UN sello, no diez', () => {
    // El render de sellos cae al default 10 si va en null, y «0 / 10» encima de
    // un descuento del 15% no significa nada para nadie.
    expect(datosDeLaPlantilla('t1', ALIANZA, NEGOCIO).stampsRequired).toBe(1);
  });

  it('queda marcada con convenioId, que es de lo que tira todo lo demás', () => {
    const d = datosDeLaPlantilla('t1', ALIANZA, NEGOCIO);
    expect(d.convenioId).toBe('c1');
    expect(d.type).toBe('STAMPS');
  });

  it('sin marca del negocio no revienta', () => {
    const d = datosDeLaPlantilla('t1', ALIANZA, null);
    expect(d.businessName).toBe('');
    expect(d.primaryColor).toBeUndefined();
  });
});

describe('cambiosDelDiseno', () => {
  it('un campo ausente no se toca', () => {
    expect(cambiosDelDiseno({}, 'Ecopetrol')).toEqual({});
    expect(cambiosDelDiseno({ name: 'X' }, 'Ecopetrol')).toEqual({ name: 'X' });
  });

  it('un campo vacío vuelve al valor por defecto', () => {
    // Es lo que espera quien borra el texto de una caja para «dejarlo como
    // estaba», en vez de quedarse con el título en blanco.
    expect(cambiosDelDiseno({ name: '   ' }, 'Ecopetrol')).toEqual({
      name: tituloPorDefecto('Ecopetrol'),
    });
  });

  it('un color inválido no se escribe, pero deja pasar el resto', () => {
    expect(
      cambiosDelDiseno({ primaryColor: 'rojo', name: 'Convenio X' }, 'Eco'),
    ).toEqual({ name: 'Convenio X' });
  });

  it('vaciar el logo es una decisión válida y llega como null', () => {
    expect(cambiosDelDiseno({ logoUrl: '' }, 'Eco')).toEqual({ logoUrl: null });
  });

  it('ignora el texto de recompensa: en una alianza lo pisan los beneficios vivos', () => {
    // Dejarlo editable permitiría una tarjeta que promete «20% de descuento»
    // mientras la caja aplica el 10%.
    expect(cambiosDelDiseno({ rewardText: '20% de descuento' } as any, 'Eco')).toEqual({});
  });

  it('NO deja tocar nada que no sea del diseño', () => {
    // Por esta ruta se escribe en `Card`. Un spread del cuerpo dejaría al dueño
    // de un convenio cambiar el tipo de tarjeta o apuntarla a otro convenio.
    const sucio = {
      name: 'Convenio X',
      type: 'CLUB',
      stampsRequired: 99,
      convenioId: 'otro',
      tenantId: 'otro',
      isActive: false,
    } as any;
    expect(cambiosDelDiseno(sucio, 'Eco')).toEqual({ name: 'Convenio X' });
  });

  it('los textos por defecto no arrastran espacios del nombre', () => {
    expect(tituloPorDefecto('  Ecopetrol  ')).toBe('Convenio Ecopetrol');
    expect(textoPorDefecto('  Ecopetrol  ')).toBe('Beneficios de Ecopetrol');
  });
});
