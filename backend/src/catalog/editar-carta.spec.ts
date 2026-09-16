import { describe, it, expect } from 'vitest';
import {
  avisosDeBorrado,
  confirmacionCoincide,
  esElMenuPrincipal,
  NOMBRE_MAX,
  revisarNombreDeCarta,
  type ResumenDeBorrado,
} from './editar-carta';

/**
 * Lo que no se puede romper al renombrar o borrar una carta:
 *
 *   1. El menú principal no se renombra ni se borra. No es una carta: es todo
 *      lo que tiene `menuId = null`, o sea el catálogo de siempre del negocio.
 *   2. Para borrar hay que escribir el nombre exacto. Es lo único que separa
 *      un clic de perder los 77 productos de una sede.
 *   3. El aviso dice los números de verdad y solo lo que aplica.
 */

describe('el menú principal no se toca', () => {
  it('sin id (el panel lo pinta como `id: null`)', () => {
    expect(esElMenuPrincipal(null)).toBe(true);
    expect(esElMenuPrincipal(undefined)).toBe(true);
  });

  it('con el null serializado en la URL, que es como llega de verdad', () => {
    expect(esElMenuPrincipal('null')).toBe(true);
    expect(esElMenuPrincipal('NULL')).toBe(true);
    expect(esElMenuPrincipal('undefined')).toBe(true);
    expect(esElMenuPrincipal(' principal ')).toBe(true);
    expect(esElMenuPrincipal('main')).toBe(true);
    expect(esElMenuPrincipal('')).toBe(true);
  });

  it('una carta de verdad sí se puede tocar', () => {
    // Nudo Estudio, en producción.
    expect(esElMenuPrincipal('35e82c9e-c2a1-4929-af4e-637071037333')).toBe(false);
  });

  it('una carta que se llame parecido no queda protegida por el nombre', () => {
    expect(esElMenuPrincipal('principal-norte')).toBe(false);
    expect(esElMenuPrincipal('mainland')).toBe(false);
  });
});

describe('el nombre de una carta', () => {
  it('vacío o de una letra no sirve', () => {
    expect(revisarNombreDeCarta('')).toEqual({
      ok: false,
      error: 'Ponle un nombre a la carta.',
    });
    expect(revisarNombreDeCarta('   ').ok).toBe(false);
    expect(revisarNombreDeCarta('A').ok).toBe(false);
    expect(revisarNombreDeCarta(null).ok).toBe(false);
    expect(revisarNombreDeCarta(undefined).ok).toBe(false);
  });

  it('se queda limpio de espacios sobrantes', () => {
    expect(revisarNombreDeCarta('  Nudo Estudio  ')).toEqual({
      ok: true,
      nombre: 'Nudo Estudio',
    });
  });

  it('un salto de línea pegado no llega al WhatsApp del negocio', () => {
    // El nombre viaja al pedido: «▸ Oficina: Sala de Juntas».
    expect(revisarNombreDeCarta('Sala de\nJuntas (1)')).toEqual({
      ok: true,
      nombre: 'Sala de Juntas (1)',
    });
  });

  it('respeta tildes, eñes y paréntesis', () => {
    expect(revisarNombreDeCarta('Salón Piñón (2)')).toEqual({
      ok: true,
      nombre: 'Salón Piñón (2)',
    });
  });

  it('un nombre larguísimo se rechaza en vez de romper el mensaje', () => {
    const largo = 'x'.repeat(NOMBRE_MAX + 1);
    const r = revisarNombreDeCarta(largo);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain(String(NOMBRE_MAX));
    // Justo en el tope sí pasa.
    expect(revisarNombreDeCarta('x'.repeat(NOMBRE_MAX)).ok).toBe(true);
  });
});

describe('la confirmación para borrar', () => {
  it('el nombre exacto abre la puerta', () => {
    expect(confirmacionCoincide('Sala de Juntas (1)', 'Sala de Juntas (1)')).toBe(
      true,
    );
  });

  it('un copiar/pegar con espacios de los lados también', () => {
    expect(confirmacionCoincide('  Nudo Estudio ', 'Nudo Estudio')).toBe(true);
  });

  it('otras mayúsculas NO: es lo único que separa de perder el catálogo', () => {
    expect(confirmacionCoincide('sala de juntas (1)', 'Sala de Juntas (1)')).toBe(
      false,
    );
  });

  it('vacío nunca confirma, ni contra una carta sin nombre', () => {
    expect(confirmacionCoincide('', 'Nudo Estudio')).toBe(false);
    expect(confirmacionCoincide('   ', 'Nudo Estudio')).toBe(false);
    expect(confirmacionCoincide(null, 'Nudo Estudio')).toBe(false);
    expect(confirmacionCoincide('', '')).toBe(false);
  });

  it('la eñe descompuesta también confirma: en pantalla es la misma carta', () => {
    // Lo que pega macOS desde algunos sitios. Sin normalizar, una carta con
    // acentos no se podía borrar y el negocio no veía por qué.
    const nfc = 'Salón Piñón';
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(confirmacionCoincide(nfd, nfc)).toBe(true);
    expect(confirmacionCoincide(nfc, nfd)).toBe(true);
  });

  it('un nombre parecido no cuela', () => {
    expect(confirmacionCoincide('Sala de Juntas', 'Sala de Juntas (1)')).toBe(
      false,
    );
  });
});

/** Nudo Estudio, tal como está hoy en producción. */
const OFICINA: ResumenDeBorrado = {
  nombre: 'Nudo Estudio',
  esOficina: true,
  productos: 77,
  categorias: 9,
  pedidos: 0,
  copiasQueLaSiguen: 0,
  sede: null,
};

describe('el aviso antes de borrar', () => {
  it('dice cuántos productos se pierden, con el número de verdad', () => {
    const avisos = avisosDeBorrado(OFICINA);
    expect(avisos[0]).toContain('77 productos');
    expect(avisos[0]).toContain('9 categorías');
  });

  it('avisa de que la oficina tiene enlace y QR repartidos', () => {
    const texto = avisosDeBorrado(OFICINA).join(' ');
    expect(texto).toContain('enlace');
    expect(texto).toContain('QR');
    // Y qué verá quien lo use: el menú principal, no una pantalla vacía.
    expect(texto).toContain('menú principal');
  });

  it('una carta con sede no habla de oficinas ni de QR repartidos', () => {
    const texto = avisosDeBorrado({
      nombre: 'Sede Yopal',
      esOficina: false,
      productos: 78,
      categorias: 18,
      pedidos: 0,
      copiasQueLaSiguen: 0,
      sede: 'Yopal',
    }).join(' ');
    expect(texto).not.toContain('Es una oficina');
    expect(texto).not.toContain('unos minutos');
    expect(texto).toContain('La sede Yopal pasará a servir el menú principal.');
  });

  it('avisa del rato en que el enlace viejo sigue vivo por la caché', () => {
    // El menú público se cachea 180 s: prometer que «verá el menú principal»
    // sin decir esto es prometer algo que no pasa en los primeros minutos.
    const texto = avisosDeBorrado(OFICINA).join(' ');
    expect(texto).toContain(
      'Durante unos minutos, quien ya tenga el enlace abierto verá un aviso de que la oficina no recibe pedidos.',
    );
  });

  it('avisa de las copias de otra carta que dejarán de actualizarse', () => {
    // «Sala de Juntas (1)» sigue a «Nudo Estudio» en producción: borrar Nudo
    // Estudio le congela los precios a la otra carta, en silencio.
    const texto = avisosDeBorrado({ ...OFICINA, copiasQueLaSiguen: 77 }).join(' ');
    expect(texto).toContain('77 productos de otra carta siguen a esta');
    expect(texto).toContain('dejarán de actualizarse solos');
  });

  it('una sola copia, en singular', () => {
    const texto = avisosDeBorrado({ ...OFICINA, copiasQueLaSiguen: 1 }).join(' ');
    expect(texto).toContain('Un producto de otra carta sigue a esta');
    expect(texto).not.toContain('1 productos');
  });

  it('sin copias enganchadas no inventa esa línea', () => {
    expect(
      avisosDeBorrado(OFICINA).some((a) => a.includes('de otra carta')),
    ).toBe(false);
  });

  it('con pedidos hechos, dice que el histórico se conserva', () => {
    const texto = avisosDeBorrado({ ...OFICINA, pedidos: 4 }).join(' ');
    expect(texto).toContain('Los 4 pedidos que ya se hicieron');
    expect(texto).toContain('se conservan');
  });

  it('con un solo pedido lo dice en singular', () => {
    // Sala de Juntas (1) tiene exactamente uno hoy en producción.
    const texto = avisosDeBorrado({ ...OFICINA, pedidos: 1 }).join(' ');
    expect(texto).toContain('El pedido que ya se hizo desde su enlace se conserva');
    expect(texto).not.toContain('Los 1 pedido');
  });

  it('sin pedidos no inventa una línea de pedidos', () => {
    expect(
      avisosDeBorrado(OFICINA).some((a) => a.includes('se conserva')),
    ).toBe(false);
  });

  it('una carta vacía no dice «se eliminarán 0 productos»', () => {
    const avisos = avisosDeBorrado({
      ...OFICINA,
      productos: 0,
      categorias: 0,
    });
    expect(avisos[0]).toBe('Esta carta está vacía: no se pierde ningún producto.');
  });

  it('una carta sin categorías no habla de «0 categorías»', () => {
    // «Corporativos», de Serendipity: 98 productos y ninguna categoría.
    const avisos = avisosDeBorrado({ ...OFICINA, productos: 98, categorias: 0 });
    expect(avisos[0]).toBe(
      'Se eliminarán 98 productos de esta carta. Esto no se puede deshacer.',
    );
  });

  it('singulares bien escritos', () => {
    const avisos = avisosDeBorrado({
      ...OFICINA,
      productos: 1,
      categorias: 1,
      pedidos: 1,
    });
    expect(avisos[0]).toContain('Se eliminarán 1 producto y 1 categoría');
    // Un solo producto y nada más: el verbo también va en singular.
    expect(
      avisosDeBorrado({ ...OFICINA, productos: 1, categorias: 0 })[0],
    ).toBe('Se eliminará 1 producto de esta carta. Esto no se puede deshacer.');
  });

  it('siempre cierra diciendo que el menú principal no se toca', () => {
    expect(avisosDeBorrado(OFICINA).at(-1)).toBe('El menú principal no se toca.');
  });
});
