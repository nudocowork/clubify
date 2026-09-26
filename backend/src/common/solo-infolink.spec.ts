import { describe, it, expect } from 'vitest';
import {
  esSoloInfolink,
  seVeEnConfiguracion,
  SECCIONES_CONFIG_OCULTAS_SOLO_INFOLINK,
  type SeccionDeConfiguracion,
} from './solo-infolink';

describe('esSoloInfolink', () => {
  it('es solo InfoLink cuando businessType es INFOLINK', () => {
    expect(esSoloInfolink('INFOLINK')).toBe(true);
  });

  it('un negocio completo no lo es', () => {
    expect(esSoloInfolink('FULL')).toBe(false);
  });

  it('null/undefined es Negocio Completo (negocios anteriores a la columna)', () => {
    expect(esSoloInfolink(null)).toBe(false);
    expect(esSoloInfolink(undefined)).toBe(false);
  });

  it('un valor desconocido NO deja a nadie sin su panel: cae a Completo', () => {
    expect(esSoloInfolink('WALLET_ONLY')).toBe(false);
    expect(esSoloInfolink('')).toBe(false);
    // Case-sensitive a propósito: el valor lo escribe el sistema, no una
    // persona. Si alguna vez llega en minúsculas es un bug de quien escribe.
    expect(esSoloInfolink('infolink')).toBe(false);
  });
});

describe('seVeEnConfiguracion', () => {
  const TODAS: SeccionDeConfiguracion[] = [
    'datosPersonales',
    'nombreDelNegocio',
    'politicaDeDatos',
    'telefonoDeReservas',
    'idioma',
    'contrasena',
    'alertasDePago',
    'paisYMoneda',
    'sellosPorDia',
    'nombreDeSeccionPrincipal',
    'exportarDatos',
    'sesion',
  ];

  it('un Negocio Completo sigue viendo TODAS las secciones', () => {
    for (const seccion of TODAS) {
      expect(seVeEnConfiguracion(seccion, 'FULL')).toBe(true);
      expect(seVeEnConfiguracion(seccion, null)).toBe(true);
    }
  });

  it('esconde al negocio de solo InfoLink lo que no es suyo', () => {
    // Cada sección oculta, UNA POR UNA. La lista se comprueba entera y no con
    // un número: la versión anterior decía `toHaveLength(6)` y se quedó vieja
    // sin que nadie se enterara —entraron `telefonosDePedidos` y
    // `horarioDeDomicilios` después—, así que la suite llevaba días en rojo y
    // se veía verde en cuanto corrías solo tu carpeta.
    //
    // Nombrarlas obliga a quien añada una a pasar por aquí y decidir si un
    // negocio de solo InfoLink tiene que verla. Un número solo obliga a
    // sumar uno.
    for (const seccion of SECCIONES_CONFIG_OCULTAS_SOLO_INFOLINK) {
      expect(seVeEnConfiguracion(seccion, 'INFOLINK')).toBe(false);
    }
    expect([...SECCIONES_CONFIG_OCULTAS_SOLO_INFOLINK].sort()).toEqual([
      'alertasDePago',
      'horarioDeDomicilios',
      'nombreDeSeccionPrincipal',
      'paisYMoneda',
      'politicaDeDatos',
      'sellosPorDia',
      'telefonoDeReservas',
      'telefonosDePedidos',
    ]);
  });

  it('le deja al InfoLink lo que sí usa: cuenta, marca, idioma y sesión', () => {
    const visibles: SeccionDeConfiguracion[] = [
      'datosPersonales',
      'nombreDelNegocio',
      'idioma',
      'contrasena',
      'exportarDatos',
      'sesion',
    ];
    for (const seccion of visibles) {
      expect(seVeEnConfiguracion(seccion, 'INFOLINK')).toBe(true);
    }
  });

  it('el nivel del InfoLink no viaja en businessType: colarlo ahí no cuela', () => {
    // El tier (gratuito o de pago) decide botones y publicidad, nunca qué
    // secciones se pintan, y por eso la función no lo recibe. Si alguien
    // intentara meterlo en `businessType`, el valor deja de reconocerse como
    // InfoLink y se veía la Configuración entera: sería un error, no un atajo.
    for (const mezcla of ['INFOLINK_PRO', 'INFOLINK_FREE', 'INFOLINK:PRO']) {
      expect(esSoloInfolink(mezcla)).toBe(false);
      for (const seccion of TODAS) {
        expect(seVeEnConfiguracion(seccion, mezcla)).toBe(true);
      }
    }
    expect(esSoloInfolink('INFOLINK')).toBe(true);
    expect(seVeEnConfiguracion('paisYMoneda', 'INFOLINK')).toBe(false);
  });
});
