import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  construirPdfDeImprenta,
  geometriaDeLaPagina,
  modulosDelQr,
  MARGEN_DE_MARCAS_MM,
  rgbACmyk,
} from './pdf-de-imprenta';

/**
 * El PDF para imprenta.
 *
 * Lo que de verdad importa aquí es una sola cosa, y está medida: si el QR se
 * rasterizara y se convirtiera a CMYK como el resto del cartel, el negro puro
 * saldría en C97 M99 Y98 K97 —391 % de tinta, cuando una prensa admite entre
 * 300 y 340—. Un QR así se empasta y puede dejar de escanear. Por eso va
 * vectorial y en K 100 %, y eso es lo primero que se prueba.
 *
 * Las pruebas leen el PDF que sale DE VERDAD, no una copia de la lógica. Se
 * genera sin comprimir (`comprimir: false`) para poder leer los operadores de
 * color como texto: PDFKit emite `/DeviceCMYK cs` + `c m y k scn` (valores 0-1)
 * en los rellenos y `CS`/`SCN` en los trazos.
 */

/** Negro puro en un relleno: una sola tinta, K 100 %. */
const RELLENO_K100 = /\/DeviceCMYK cs\s+0 0 0 1 scn/;
/** Negro puro en un trazo (las marcas de corte). */
const TRAZO_K100 = /\/DeviceCMYK CS\s+0 0 0 1 SCN/;

async function cartelDePrueba(): Promise<Buffer> {
  // Un cartel cualquiera: lo que importa es que no sea el QR.
  return sharp({
    create: { width: 210, height: 297, channels: 3, background: { r: 240, g: 90, b: 60 } },
  })
    .png()
    .toBuffer();
}

async function pdfComoTexto(opts: Parameters<typeof construirPdfDeImprenta>[0]) {
  const buf = await construirPdfDeImprenta({ comprimir: false, ...opts });
  return { buf, texto: buf.toString('latin1') };
}

describe('el PDF para imprenta', () => {
  it('es un PDF de verdad', async () => {
    const { buf } = await pdfComoTexto({
      mm: { w: 210, h: 297 },
      cartel: await cartelDePrueba(),
      qr: null,
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('EL QR SALE EN NEGRO PURO (K 100 %), no en cuatro tintas', async () => {
    // Si el QR estuviera en cuatro tintas aparecería algo como
    // `0.97 0.99 0.98 0.97 scn`, que es lo que da la conversión automática.
    const { texto } = await pdfComoTexto({
      mm: { w: 210, h: 297 },
      cartel: await cartelDePrueba(),
      qr: { url: 'https://app.soyclubify.com/q/abc123', x: 0.3, y: 0.4, lado: 0.4 },
      marcasDeCorte: false,
    });
    expect(texto).toMatch(RELLENO_K100);
  });

  it('sin QR no hay ningún relleno en negro puro', async () => {
    // Asegura que la prueba anterior mide el QR y no otra cosa.
    const { texto } = await pdfComoTexto({
      mm: { w: 210, h: 297 },
      cartel: await cartelDePrueba(),
      qr: null,
      marcasDeCorte: false,
    });
    expect(texto).not.toMatch(RELLENO_K100);
  });

  it('las marcas de corte también van en K 100 %', async () => {
    // Una marca en cuatro tintas sale borrosa, y es la referencia de la
    // guillotina.
    const { texto } = await pdfComoTexto({
      mm: { w: 210, h: 297 },
      cartel: await cartelDePrueba(),
      qr: null,
      marcasDeCorte: true,
    });
    expect(texto).toMatch(TRAZO_K100);
  });

  it('la página mide el corte más el sangrado (y las marcas)', async () => {
    const { texto } = await pdfComoTexto({
      mm: { w: 210, h: 297 },
      cartel: await cartelDePrueba(),
      qr: null,
      marcasDeCorte: false,
    });
    // 216 × 303 mm en puntos (72 por pulgada).
    const pt = (mm: number) => (mm * 72) / 25.4;
    const caja = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(texto);
    expect(caja).not.toBeNull();
    expect(Number(caja![1])).toBeCloseTo(pt(216), 0);
    expect(Number(caja![2])).toBeCloseTo(pt(303), 0);
  });
});

describe('la geometría de la página', () => {
  it('añade 3 mm de sangrado por cada lado', () => {
    const g = geometriaDeLaPagina({ mm: { w: 210, h: 297 }, sangradoMm: 3, marcasDeCorte: false });
    expect(g.paginaMm).toEqual({ w: 216, h: 303 });
    // El corte queda centrado, a 3 mm del borde.
    expect(g.corteMm).toEqual({ x: 3, y: 3, w: 210, h: 297 });
    // Y el arte cubre la hoja entera, sangrado incluido.
    expect(g.arteMm).toEqual({ x: 0, y: 0, w: 216, h: 303 });
  });

  it('con marcas de corte deja sitio fuera del sangrado', () => {
    const g = geometriaDeLaPagina({ mm: { w: 210, h: 297 }, sangradoMm: 3, marcasDeCorte: true });
    const m = MARGEN_DE_MARCAS_MM;
    expect(g.paginaMm).toEqual({ w: 210 + 2 * (3 + m), h: 297 + 2 * (3 + m) });
    // El corte sigue a sangrado + margen del borde.
    expect(g.corteMm.x).toBe(3 + m);
    // El arte empieza donde acaba el margen de las marcas: las marcas no
    // pueden quedar encima del dibujo.
    expect(g.arteMm.x).toBe(m);
  });
});

describe('el QR vectorial', () => {
  it('lee la matriz real del código', () => {
    const { lado, oscuro } = modulosDelQr('https://app.soyclubify.com/q/abc123');
    // Un QR tiene 21 + 4·n módulos de lado.
    expect((lado - 21) % 4).toBe(0);
    // Los tres cuadros de posición tienen la esquina oscura.
    expect(oscuro(0, 0)).toBe(true);
    expect(oscuro(0, lado - 1)).toBe(true);
    expect(oscuro(lado - 1, 0)).toBe(true);
    // Un cuadro de posición es un anillo oscuro, un anillo CLARO y un centro
    // oscuro de 3×3. Si la matriz estuviera mal leída —filas por columnas, o
    // desplazada— esto no cuadraría. (La esquina de abajo a la derecha son
    // DATOS: puede salir oscura o clara, no sirve para comprobar nada.)
    expect(oscuro(1, 1)).toBe(false);
    expect(oscuro(3, 3)).toBe(true);
    // Y el separador que rodea al cuadro es claro.
    expect(oscuro(7, 0)).toBe(false);
    expect(oscuro(0, 7)).toBe(false);
  });
});

/**
 * La conversión del cartel a CMYK.
 *
 * El motivo de no usar `sharp.toColourspace('cmyk')`, medido: convierte el negro
 * puro en C97 M99 Y98 K97 (391 % de tinta). No es solo el QR —ese va aparte,
 * vectorial—: son todos los TEXTOS negros del cartel. Estas pruebas fijan las
 * dos garantías de la conversión propia.
 */
describe('la conversión del cartel a CMYK', () => {
  const pct = (v: number) => Math.round((v / 255) * 100);
  const cmyk = (r: number, g: number, b: number) => {
    const o = rgbACmyk(Buffer.from([r, g, b]));
    return { c: pct(o[0]), m: pct(o[1]), y: pct(o[2]), k: pct(o[3]) };
  };

  it('el NEGRO sale solo en tinta negra, no en las cuatro', () => {
    // El caso que decide todo: los textos negros del cartel.
    expect(cmyk(0, 0, 0)).toEqual({ c: 0, m: 0, y: 0, k: 100 });
  });

  it('el blanco no lleva tinta', () => {
    expect(cmyk(255, 255, 255)).toEqual({ c: 0, m: 0, y: 0, k: 0 });
  });

  it('un gris sale solo en negro: sin registro que se pueda desplazar', () => {
    const g = cmyk(128, 128, 128);
    expect(g.c + g.m + g.y).toBe(0);
    expect(g.k).toBeGreaterThan(0);
  });

  it('NINGÚN color pasa del 300 % de tinta (el límite de una prensa)', () => {
    // Barrido de toda la gama en pasos de 17 (16³ ≈ 4.000 colores).
    let peor = 0;
    for (let r = 0; r <= 255; r += 17)
      for (let g = 0; g <= 255; g += 17)
        for (let b = 0; b <= 255; b += 17) {
          const o = rgbACmyk(Buffer.from([r, g, b]));
          const total = ((o[0] + o[1] + o[2] + o[3]) / 255) * 100;
          if (total > peor) peor = total;
        }
    expect(peor).toBeLessThanOrEqual(300.5);
  });

  it('un color vivo conserva su color (no se vuelve gris)', () => {
    // El rojo de la marca: sin cian, con magenta y amarillo.
    const rojo = cmyk(240, 60, 50);
    expect(rojo.c).toBe(0);
    expect(rojo.m).toBeGreaterThan(50);
    expect(rojo.y).toBeGreaterThan(50);
  });

  it('el PDF lleva el cartel como imagen CMYK de verdad', async () => {
    const buf = await construirPdfDeImprenta({
      mm: { w: 100, h: 100 },
      cartel: await cartelDePrueba(),
      qr: null,
      marcasDeCorte: false,
      comprimir: false,
    });
    expect(buf.toString('latin1')).toMatch(/\/ColorSpace \/DeviceCMYK/);
  });

  it('en modo «rgb» lo deja para que la imprenta aplique su perfil', async () => {
    const buf = await construirPdfDeImprenta({
      mm: { w: 100, h: 100 },
      cartel: await cartelDePrueba(),
      qr: null,
      marcasDeCorte: false,
      colores: 'rgb',
      comprimir: false,
    });
    expect(buf.toString('latin1')).not.toMatch(/\/ColorSpace \/DeviceCMYK/);
  });
});
