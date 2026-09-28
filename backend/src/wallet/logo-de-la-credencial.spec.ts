import { describe, it, expect } from 'vitest';
import {
  ALTO_FRANJA,
  ANCHO_FRANJA,
  CONTRASTE_MINIMO_DEL_LOGO,
  cajaDelLogo,
  luminanciaDeLoVisible,
  planchaParaElLogo,
} from './logo-de-la-credencial';
import { aRgb, luminancia } from '../cards/color-de-la-credencial';

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
const AZUL_OSCURO = aRgb('#1B2A4A')!;

describe('¿hace falta plancha detrás del logo?', () => {
  it('EL CASO QUE LO OBLIGA: logo negro sobre credencial negra', () => {
    // Sin esto, Degodoy repartiría credenciales con el centro en blanco.
    const plancha = planchaParaElLogo({
      fondo: NEGRO_DE_DEGODOY,
      luminanciaDelLogo: luminanciaDeLoVisible(logoLiso('#111111')),
    });
    expect(plancha).toBe('#FFFFFF');
  });

  it('un logo BLANCO sobre fondo oscuro va limpio, sin plancha', () => {
    // Es el caso bueno y el más común en una credencial: el negocio eligió el
    // fondo oscuro justamente porque su marca es clara. Meterle un rectángulo
    // blanco detrás le rompería el diseño.
    expect(
      planchaParaElLogo({
        fondo: NEGRO_DE_DEGODOY,
        luminanciaDelLogo: luminanciaDeLoVisible(logoLiso('#FFFFFF')),
      }),
    ).toBeNull();
  });

  it('manda el fondo que el negocio ELIGIÓ, aunque el logo contrastara', () => {
    // Es una decisión suya, y la cabecera del pase ya la respeta.
    expect(
      planchaParaElLogo({
        fondo: NEGRO_DE_DEGODOY,
        logoBgColor: '#FF6B35',
        luminanciaDelLogo: luminanciaDeLoVisible(logoLiso('#FFFFFF')),
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
        luminanciaDelLogo: luminanciaDeLoVisible(logoLiso('#FFFFFF')),
      }),
    ).toBeNull();
  });

  it('si NO se sabe de qué color es el logo, no se inventa nada', () => {
    // Un logo enteramente transparente no tiene color que comparar. Poner una
    // plancha «por si acaso» le mete un rectángulo a quien no lo necesita.
    expect(
      planchaParaElLogo({ fondo: NEGRO_DE_DEGODOY, luminanciaDelLogo: null }),
    ).toBeNull();
  });

  it('sobre un fondo CLARO la plancha es oscura, no blanca', () => {
    // El gate del color impide guardar hoy una credencial clara, pero las
    // creadas antes de que existiera siguen ahí. Una plancha blanca sobre
    // fondo blanco no arreglaría nada.
    expect(
      planchaParaElLogo({
        fondo: aRgb('#F5F5F5')!,
        luminanciaDelLogo: luminanciaDeLoVisible(logoLiso('#FFFFFF')),
      }),
    ).toBe('#111111');
  });

  it('EL UMBRAL ES EL DE UN GRÁFICO (3:1), NO EL DE UN TEXTO (4.5:1)', () => {
    // Si alguien lo sube a 4.5 «por rigor», casi cualquier logo pediría
    // plancha y se acaba el «ajustado al estilo de la tarjeta». Este caso cae
    // justo entre los dos umbrales y tiene que pasar SIN plancha.
    const gris = luminanciaDeLoVisible(logoLiso('#8A8A8A'))!;
    const ratio =
      (Math.max(gris, luminancia(AZUL_OSCURO)) + 0.05) /
      (Math.min(gris, luminancia(AZUL_OSCURO)) + 0.05);
    expect(ratio).toBeGreaterThan(CONTRASTE_MINIMO_DEL_LOGO);
    expect(ratio).toBeLessThan(4.5);
    expect(
      planchaParaElLogo({ fondo: AZUL_OSCURO, luminanciaDelLogo: gris }),
    ).toBeNull();
  });
});

describe('de qué color es lo que SE VE del logo', () => {
  it('los píxeles TRANSPARENTES no cuentan', () => {
    // Un logo blanco sobre un PNG transparente: los huecos suelen venir en
    // (0,0,0) y, contándolos, el logo parecería oscuro y se le pondría una
    // plancha blanca que no hace falta. Con otros codificadores —que rellenan
    // el transparente de blanco— pasaría al revés. Mismo logo, dos respuestas.
    const blanco = luminanciaDeLoVisible(logoLiso('#FFFFFF'))!;
    const conHuecos = new Uint8Array(32 * 4); // (0,0,0,0) = transparente
    const visible = logoLiso('#FFFFFF', { pixeles: 4 });
    conHuecos.set(visible, 0);
    expect(luminanciaDeLoVisible(conHuecos)).toBeCloseTo(blanco, 6);
  });

  it('un píxel a MEDIA opacidad no cuenta como sólido', () => {
    expect(luminanciaDeLoVisible(logoLiso('#FFFFFF', { alpha: 40 }))).toBeNull();
  });

  it('un logo del todo transparente devuelve null, no 0', () => {
    // 0 es la luminancia del NEGRO, y devolverlo haría que un logo invisible
    // pidiera plancha como si fuera negro.
    expect(luminanciaDeLoVisible(new Uint8Array(64))).toBeNull();
  });

  it('LA PRUEBA SABE PONERSE EN ROJO: distingue negro de blanco', () => {
    // Si la lectura de píxeles se rompiera y devolviera siempre lo mismo, todo
    // lo de arriba seguiría en verde sin mirar nada.
    const negro = luminanciaDeLoVisible(logoLiso('#000000'))!;
    const blanco = luminanciaDeLoVisible(logoLiso('#FFFFFF'))!;
    expect(negro).toBeCloseTo(0, 6);
    expect(blanco).toBeCloseTo(1, 6);
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
