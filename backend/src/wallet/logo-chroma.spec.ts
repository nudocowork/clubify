import { describe, expect, it } from 'vitest';
import { removeBorderConnectedWhite } from './logo-chroma';

/**
 * El bug que cubre esta suite (PDF de peticiones 2026-08): el chroma-key
 * global borraba TAMBIÉN las letras blancas dentro del logo, no solo el
 * fondo. El flood-fill desde los bordes debe quitar únicamente el blanco
 * conectado al exterior.
 */

/** Construye un RGBA plano desde una grilla de caracteres:
 *  'W' = blanco (255), 'D' = oscuro (30), 'G' = casi-blanco (245). */
function rgba(rows: string[]): { data: Uint8Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8Array(w * h * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = row[x] === 'D' ? 30 : row[x] === 'G' ? 245 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  });
  return { data, w, h };
}

const alphaAt = (out: Uint8Array, w: number, x: number, y: number) =>
  out[(y * w + x) * 4 + 3];

describe('removeBorderConnectedWhite', () => {
  it('quita el fondo blanco del borde pero conserva las letras blancas interiores', () => {
    // Logo "letra blanca dentro de forma oscura" sobre fondo blanco.
    const { data, w, h } = rgba([
      'WWWWWW',
      'WDDDDW',
      'WDWWDW', // los dos W del centro son la "letra" — no tocan el borde
      'WDDDDW',
      'WWWWWW',
    ]);
    const out = removeBorderConnectedWhite(data, w, h);

    // Fondo (esquina y laterales): transparente.
    expect(alphaAt(out, w, 0, 0)).toBe(0);
    expect(alphaAt(out, w, 5, 4)).toBe(0);
    expect(alphaAt(out, w, 0, 2)).toBe(0);
    // Letra blanca interior: intacta.
    expect(alphaAt(out, w, 2, 2)).toBe(255);
    expect(alphaAt(out, w, 3, 2)).toBe(255);
    // La forma oscura: intacta.
    expect(alphaAt(out, w, 1, 1)).toBe(255);
  });

  it('no toca un logo con letras blancas sobre fondo de color (sin blanco en el borde)', () => {
    const { data, w, h } = rgba([
      'DDDDD',
      'DWWWD',
      'DDDDD',
    ]);
    const out = removeBorderConnectedWhite(data, w, h);
    // Sin semillas en el borde → nada se vuelve transparente.
    for (let p = 0; p < w * h; p++) {
      expect(out[p * 4 + 3]).toBe(255);
    }
  });

  it('trata el casi-blanco (≥ umbral) del borde como fondo — caso JPG comprimido', () => {
    const { data, w, h } = rgba([
      'GGGG',
      'GDDG',
      'GGGG',
    ]);
    const out = removeBorderConnectedWhite(data, w, h);
    expect(alphaAt(out, w, 0, 0)).toBe(0);
    expect(alphaAt(out, w, 1, 1)).toBe(255);
  });

  it('el fondo entra por canales estrechos conectados al borde', () => {
    // El blanco del centro está conectado al borde por un pasillo de 1px.
    const { data, w, h } = rgba([
      'WWWWW',
      'DDWDD',
      'DDWDD',
      'DDDDD',
    ]);
    const out = removeBorderConnectedWhite(data, w, h);
    expect(alphaAt(out, w, 2, 1)).toBe(0);
    expect(alphaAt(out, w, 2, 2)).toBe(0);
  });

  it('no muta la entrada y tolera imágenes vacías', () => {
    const { data, w, h } = rgba(['WW', 'WW']);
    const before = Array.from(data);
    removeBorderConnectedWhite(data, w, h);
    expect(Array.from(data)).toEqual(before);
    expect(removeBorderConnectedWhite(new Uint8Array(0), 0, 0)).toHaveLength(0);
  });
});
