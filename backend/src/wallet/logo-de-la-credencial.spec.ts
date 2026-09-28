import { describe, it, expect } from 'vitest';
import {
  ALTO_FRANJA,
  ANCHO_FRANJA,
  MINIMO_QUE_DESTACA,
  cajaDelLogo,
  contenidoQueContrasta,
  planchaParaElLogo,
} from './logo-de-la-credencial';
import { aRgb } from '../cards/color-de-la-credencial';

/**
 * El logo centrado de una credencial, y lo único que puede salir mal en
 * silencio: que desaparezca.
 *
 * El fondo de una credencial es OSCURO por diseño —`motivoParaRechazarElColor`
 * no deja guardar un color que no contraste con el texto blanco del pase— y un
 * montón de logos vienen en negro sobre transparente. Sin medir, el logo que
 * acabamos de poner en el centro se funde con el fondo y nadie se entera: en la
 * vista previa del panel tampoco se vería, porque allí se pinta sobre ese mismo
 * color.
 */

/** Un logo de un solo color, en crudo RGBA, como lo entrega sharp. */
function logoLiso(hex: string, opciones: { alpha?: number; pixeles?: number } = {}) {
  const c = aRgb(hex)!;
  const alpha = opciones.alpha ?? 255;
  const n = opciones.pixeles ?? 16;
  const b = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    b[i * 4] = c.r;
    b[i * 4 + 1] = c.g;
    b[i * 4 + 2] = c.b;
    b[i * 4 + 3] = alpha;
  }
  return b;
}

const NEGRO_DE_DEGODOY = aRgb('#000000')!;

/**
 * El logo REAL de Degodoy, en pequeño: un cuadro con el fondo NEGRO y el
 * logotipo en letras blancas finas. Es el caso que tumbó la primera versión de
 * esto, así que va aquí como dato y no como nota al pie.
 */
function logoDeDegodoy(porcentajeDeLetra = 0.1) {
  const total = 200;
  const letras = Math.round(total * porcentajeDeLetra);
  const b = new Uint8Array(total * 4);
  for (let i = 0; i < total; i++) {
    const claro = i < letras;
    b[i * 4] = b[i * 4 + 1] = b[i * 4 + 2] = claro ? 255 : 8;
    b[i * 4 + 3] = 255;
  }
  return b;
}

describe('¿hace falta plancha detrás del logo?', () => {
  it('EL CASO QUE LO OBLIGA: logo negro entero sobre credencial negra', () => {
    // Sin esto, el centro de la credencial sale vacío y nadie lo ve: en la
    // vista previa del panel se pinta sobre el mismo color.
    const plancha = planchaParaElLogo({
      fondo: NEGRO_DE_DEGODOY,
      queDestaca: contenidoQueContrasta(logoLiso('#111111'), NEGRO_DE_DEGODOY),
    });
    expect(plancha).toBe('#FFFFFF');
  });

  it('EL CASO QUE ROMPIÓ LA PRIMERA VERSIÓN: Degodoy, letras claras sobre su propio fondo negro', () => {
    // Su logo es un JPG con fondo negro y «DEGODOY COCINA» en letras finas. Con
    // la LUMINANCIA MEDIA daba «casi negro» sobre una tarjeta negra, pedía
    // plancha, y la credencial salía con un marco blanco alrededor de un
    // recuadro negro. Se vio al renderizarla de verdad, no leyendo el código.
    //
    // Un logo no se lee por su color promedio: se lee por los trazos que
    // destacan. Este tiene ~10 % de letra clara y se lee perfectamente.
    expect(
      planchaParaElLogo({
        fondo: NEGRO_DE_DEGODOY,
        queDestaca: contenidoQueContrasta(logoDeDegodoy(), NEGRO_DE_DEGODOY),
      }),
    ).toBeNull();
  });

  it('un logo BLANCO sobre fondo oscuro va limpio, sin plancha', () => {
    // El caso bueno y el más común: el negocio eligió el fondo oscuro
    // justamente porque su marca es clara.
    expect(
      planchaParaElLogo({
        fondo: NEGRO_DE_DEGODOY,
        queDestaca: contenidoQueContrasta(logoLiso('#FFFFFF'), NEGRO_DE_DEGODOY),
      }),
    ).toBeNull();
  });

  it('manda el fondo que el negocio ELIGIÓ, aunque el logo contrastara', () => {
    // Es una decisión suya, y la cabecera del pase ya la respeta.
    expect(
      planchaParaElLogo({
        fondo: NEGRO_DE_DEGODOY,
        logoBgColor: '#FF6B35',
        queDestaca: contenidoQueContrasta(logoLiso('#FFFFFF'), NEGRO_DE_DEGODOY),
      }),
    ).toBe('#FF6B35');
  });

  it('un `logoBgColor` que no se entiende NO se pinta', () => {
    // Pasó de verdad en otro campo de color: un negocio escribió ahí el nombre
    // de su restaurante. Se ignora y se decide midiendo.
    expect(
      planchaParaElLogo({
        fondo: NEGRO_DE_DEGODOY,
        logoBgColor: 'Restaurante La Estación',
        queDestaca: contenidoQueContrasta(logoLiso('#FFFFFF'), NEGRO_DE_DEGODOY),
      }),
    ).toBeNull();
  });

  it('si NO se sabe qué parte del logo destaca, no se inventa nada', () => {
    expect(
      planchaParaElLogo({ fondo: NEGRO_DE_DEGODOY, queDestaca: null }),
    ).toBeNull();
  });

  it('sobre un fondo CLARO la plancha es oscura, no blanca', () => {
    // El gate del color impide guardar hoy una credencial clara, pero las
    // creadas antes de que existiera siguen ahí. Una plancha blanca sobre
    // fondo blanco no arreglaría nada.
    const claro = aRgb('#F5F5F5')!;
    expect(
      planchaParaElLogo({
        fondo: claro,
        queDestaca: contenidoQueContrasta(logoLiso('#FAFAFA'), claro),
      }),
    ).toBe('#111111');
  });

  it('EL UMBRAL ES BAJO A PROPÓSITO: un logotipo fino es poco porcentaje', () => {
    // Si alguien lo sube «por rigor», los logos de letra fina —que son
    // legibles— empiezan a llevar plancha y se acaba el «ajustado al estilo de
    // la tarjeta». Con un 4 % de trazo claro todavía se lee.
    expect(MINIMO_QUE_DESTACA).toBeLessThanOrEqual(0.05);
    expect(
      planchaParaElLogo({
        fondo: NEGRO_DE_DEGODOY,
        queDestaca: contenidoQueContrasta(logoDeDegodoy(0.04), NEGRO_DE_DEGODOY),
      }),
    ).toBeNull();
  });
});

describe('qué parte del logo se distingue del fondo', () => {
  it('los píxeles TRANSPARENTES no cuentan', () => {
    // Los huecos de un PNG suelen venir en (0,0,0) y contarlos haría parecer
    // oscuro un logo claro; con otros codificadores, que los rellenan de
    // blanco, pasaría al revés. Mismo logo, dos respuestas.
    const conHuecos = new Uint8Array(32 * 4); // (0,0,0,0) = transparente
    conHuecos.set(logoLiso('#FFFFFF', { pixeles: 4 }), 0);
    expect(contenidoQueContrasta(conHuecos, NEGRO_DE_DEGODOY)).toBe(1);
  });

  it('un píxel a MEDIA opacidad no cuenta como sólido', () => {
    expect(
      contenidoQueContrasta(logoLiso('#FFFFFF', { alpha: 40 }), NEGRO_DE_DEGODOY),
    ).toBeNull();
  });

  it('un logo del todo transparente devuelve null, no 0', () => {
    // 0 significa «no destaca nada» y pediría plancha. `null` significa «no hay
    // logo», y entonces no se dibuja franja siquiera.
    expect(contenidoQueContrasta(new Uint8Array(64), NEGRO_DE_DEGODOY)).toBeNull();
  });

  it('LA PRUEBA SABE PONERSE EN ROJO: distingue lo que se ve de lo que no', () => {
    // Si la lectura de píxeles se rompiera y devolviera siempre lo mismo, todo
    // lo de arriba seguiría en verde sin mirar nada.
    expect(contenidoQueContrasta(logoLiso('#FFFFFF'), NEGRO_DE_DEGODOY)).toBe(1);
    expect(contenidoQueContrasta(logoLiso('#050505'), NEGRO_DE_DEGODOY)).toBe(0);
    expect(contenidoQueContrasta(logoDeDegodoy(0.25), NEGRO_DE_DEGODOY)).toBeCloseTo(0.25, 2);
  });
});

describe('dónde cabe el logo', () => {
  it('deja aire a los lados: no ocupa la franja entera', () => {
    const caja = cajaDelLogo();
    expect(caja.ancho).toBeLessThan(ANCHO_FRANJA);
    expect(caja.alto).toBeLessThan(ALTO_FRANJA);
    // Y tampoco es un sello diminuto: el pedido era verlo GRANDE.
    expect(caja.ancho).toBeGreaterThan(ANCHO_FRANJA * 0.5);
    expect(caja.alto).toBeGreaterThan(ALTO_FRANJA * 0.5);
  });

  it('la franja es la de Apple para un storeCard: 320×123 a 2x', () => {
    // Si alguien cambia estos números, el pase instalado escala la imagen y el
    // logo sale borroso o recortado.
    expect(ANCHO_FRANJA).toBe(640);
    expect(ALTO_FRANJA).toBe(246);
    expect(ANCHO_FRANJA / ALTO_FRANJA).toBeCloseTo(320 / 123, 2);
  });
});
