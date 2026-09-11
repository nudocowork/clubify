import { describe, it, expect } from 'vitest';
import { sanearPremiosIntermedios } from './premios-intermedios';

/**
 * Los premios intermedios de una tarjeta de sellos.
 *
 * La regla estaba METIDA dentro de `CardsService` como método privado, así que
 * el panel validaba y el Onboarding ni siquiera miraba el campo: el cliente
 * configuraba sus premios en el formulario y no aparecían en ningún sitio.
 * Ahora la comparten las dos puertas, y esto es lo que impide que diverjan.
 */
describe('sanearPremiosIntermedios', () => {
  it('undefined es «no los toques», y NO es lo mismo que []', () => {
    // Un sync que no habla del tema no puede borrar los que el negocio ya
    // configuró a mano desde el panel.
    expect(sanearPremiosIntermedios(undefined, 10)).toBeUndefined();
    expect(sanearPremiosIntermedios([], 10)).toEqual([]);
  });

  it('deja pasar un premio bien puesto, con sus valores por defecto', () => {
    const r = sanearPremiosIntermedios(
      [{ pos: 3, text: 'Café', emoji: '☕' }],
      10,
    )!;
    expect(r).toHaveLength(1);
    expect(r[0].pos).toBe(3);
    expect(r[0].text).toBe('Café');
    expect(r[0].emoji).toBe('☕');
    // Sin `active` explícito se enciende: quien lo manda lo quiere puesto.
    expect(r[0].active).toBe(true);
    // Y nace con id aunque no se lo den.
    expect(r[0].id).toBeTruthy();
  });

  it('descarta una posición MAYOR que el total de sellos', () => {
    // Un premio en el sello 12 de una tarjeta de 10 no se dibuja nunca.
    // Guardarlo solo engaña a quien lo configuró.
    const r = sanearPremiosIntermedios(
      [{ pos: 3, text: 'ok' }, { pos: 12, text: 'fantasma' }],
      10,
    )!;
    expect(r.map((x) => x.pos)).toEqual([3]);
  });

  it('descarta posiciones 0, negativas y no numéricas', () => {
    const r = sanearPremiosIntermedios(
      [{ pos: 0 }, { pos: -2 }, { pos: 'tres' }, { pos: null }, { pos: 4 }],
      10,
    )!;
    expect(r.map((x) => x.pos)).toEqual([4]);
  });

  it('una posición, un premio: gana el primero', () => {
    // Dos en el mismo círculo se pintarían encima.
    const r = sanearPremiosIntermedios(
      [{ pos: 5, text: 'primero' }, { pos: 5, text: 'segundo' }],
      10,
    )!;
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe('primero');
  });

  it('los devuelve ordenados por posición, vengan como vengan', () => {
    const r = sanearPremiosIntermedios(
      [{ pos: 7 }, { pos: 2 }, { pos: 5 }],
      10,
    )!;
    expect(r.map((x) => x.pos)).toEqual([2, 5, 7]);
  });

  it('un color que no es hex se cae a null en vez de romper la tarjeta', () => {
    // Sin esto, cualquier texto se guardaba como color y la tarjeta se rompia
    // en silencio.
    const r = sanearPremiosIntermedios(
      [{ pos: 1, circleColor: 'amarillo', textColor: '#FFF' }],
      10,
    )!;
    expect(r[0].circleColor).toBeNull();
    expect(r[0].textColor).toBe('#FFF');
  });

  it('recorta el texto a 24 y el emoji a 8 para que quepan en el círculo', () => {
    const r = sanearPremiosIntermedios(
      [{ pos: 1, text: 'x'.repeat(60), emoji: '🎁'.repeat(20) }],
      10,
    )!;
    expect(r[0].text).toHaveLength(24);
    expect(r[0].emoji.length).toBeLessThanOrEqual(8);
  });

  it('sin total de sellos no se descarta nada por posición', () => {
    // `stampsRequired` ausente = no sabemos el máximo; descartar seria peor.
    const r = sanearPremiosIntermedios([{ pos: 99 }], null)!;
    expect(r.map((x) => x.pos)).toEqual([99]);
  });

  it('no hay tope de cantidad', () => {
    const muchos = Array.from({ length: 40 }, (_, i) => ({ pos: i + 1 }));
    expect(sanearPremiosIntermedios(muchos, 40)).toHaveLength(40);
  });

  it('respeta `active: false`', () => {
    const r = sanearPremiosIntermedios([{ pos: 1, active: false }], 10)!;
    expect(r[0].active).toBe(false);
  });

  it('lo que no es un arreglo se trata como «bórralos»', () => {
    expect(sanearPremiosIntermedios('nada' as any, 10)).toEqual([]);
  });
});
