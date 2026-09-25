import { describe, it, expect } from 'vitest';
import {
  CONTRASTE_MINIMO,
  contrasteConElTexto,
  motivoParaRechazarElColor,
} from './color-de-la-credencial';

/**
 * El color de fondo de una credencial tiene que dejar leer el texto.
 *
 * El texto del pase de Apple es blanco EN DURO. En una tarjeta de sellos eso
 * se nota poco —el cartón tapa media tarjeta—, pero en una informativa el
 * fondo ES la tarjeta, así que un color claro reparte credenciales en blanco
 * sobre blanco.
 */

describe('el color de fondo de una credencial', () => {
  it('EL CASO: negro sobre blanco se lee, y de sobra', () => {
    expect(motivoParaRechazarElColor('#000000')).toBeNull();
    expect(contrasteConElTexto('#000000')).toBeCloseTo(21, 0);
  });

  it('un casi blanco se RECHAZA — es blanco sobre blanco', () => {
    expect(motivoParaRechazarElColor('#FAFAFA')).toMatch(/demasiado claro/);
    expect(motivoParaRechazarElColor('#FFFFFF')).toMatch(/demasiado claro/);
  });

  it('y el motivo se lo lee el NEGOCIO, no un programador', () => {
    const motivo = motivoParaRechazarElColor('#FFFF00');
    expect(motivo).toMatch(/texto de la credencial es blanco/);
    expect(motivo).toMatch(/color más oscuro/);
    expect(motivo).not.toMatch(/contrast|ratio|WCAG|AA/i);
  });

  it('los colores de marca oscuros pasan', () => {
    // Verde Clubify oscuro, vino, azul noche: los que de verdad se usan.
    for (const c of ['#0F3D2E', '#7F1D1D', '#1E3A8A', '#3F3F46']) {
      expect(motivoParaRechazarElColor(c)).toBeNull();
    }
  });

  it('acepta el hex de tres cifras y sin almohadilla', () => {
    expect(motivoParaRechazarElColor('#000')).toBeNull();
    expect(motivoParaRechazarElColor('000000')).toBeNull();
    expect(motivoParaRechazarElColor('#fff')).toMatch(/demasiado claro/);
  });

  it('un color ININTELIGIBLE no bloquea el guardado', () => {
    // El caso real que motivó `safeBrandColor`: un negocio tenía escrito
    // «Degodoy cocina» dentro del campo de color. Eso ya se recoge más
    // adelante cayendo a un color válido; convertirlo aquí en «no puedes
    // guardar» sería peor que el problema.
    expect(motivoParaRechazarElColor('Degodoy cocina')).toBeNull();
    expect(motivoParaRechazarElColor('')).toBeNull();
    expect(contrasteConElTexto('no es un color')).toBeNull();
  });

  it('el umbral es el AA de WCAG, el mismo que usa la pantalla', () => {
    expect(CONTRASTE_MINIMO).toBe(4.5);
    // Justo por encima y justo por debajo del umbral.
    const gris = '#767676'; // ~4.54:1 contra blanco
    const grisClaro = '#797979'; // ~4.47:1
    expect(contrasteConElTexto(gris)!).toBeGreaterThanOrEqual(4.5);
    expect(contrasteConElTexto(grisClaro)!).toBeLessThan(4.5);
    expect(motivoParaRechazarElColor(gris)).toBeNull();
    expect(motivoParaRechazarElColor(grisClaro)).not.toBeNull();
  });

  it('la prueba sabe ponerse en ROJO: mirar solo el brillo no basta', () => {
    // Un criterio ingenuo —«es claro si R+G+B pasa de la mitad»— deja pasar el
    // amarillo puro, que contra blanco tiene 1.07:1 y es ilegible.
    const ingenuo = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3 > 128;
    };
    expect(ingenuo('#FFFF00')).toBe(true); // el ingenuo lo llamaría claro…
    expect(ingenuo('#00FF00')).toBe(false); // …pero al verde puro NO
    expect(contrasteConElTexto('#00FF00')!).toBeLessThan(4.5); // y sí es ilegible
    expect(motivoParaRechazarElColor('#00FF00')).not.toBeNull();
  });
});
