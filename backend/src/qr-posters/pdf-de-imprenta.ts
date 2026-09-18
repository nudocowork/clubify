/**
 * El PDF que se le manda a la imprenta.
 *
 * POR QUÉ EXISTE (Javier, 2026-09-18): «nuestro editor sí utiliza el creador de
 * QR para los diseños de los habladores, sin embargo no está la posibilidad de
 * exportar los diseños en formato CMYK».
 *
 * EL PROBLEMA DE FONDO: el editor dibuja en un canvas del navegador, y un
 * canvas solo sabe hacer color de pantalla (RGB). No existe un canvas CMYK; no
 * es una limitación de la librería, es de la especificación. Así que el PDF de
 * hoy es una foto RGB estirada dentro de una página, sin sangrado, sin marcas
 * de corte y con el QR rasterizado.
 *
 * ── LA TRAMPA QUE DECIDE TODO EL DISEÑO ──────────────────────────────────────
 *
 * Convertir la imagen entera a CMYK y ya está NO sirve, y no por poco. Medido
 * en esta máquina con el sharp que tenemos (0.34.5 / libvips 8.17.3), el negro
 * puro RGB(0,0,0) se convierte en:
 *
 *     C 97 %   M 99 %   Y 98 %   K 97 %      → 391 % de tinta
 *
 * Una prensa admite entre 300 y 340 %. Un QR impreso así se empasta, pierde
 * contraste y **puede dejar de escanear** — y el negocio se entera con los
 * habladores ya impresos y pagados.
 *
 * Por eso el QR NO se rasteriza: se dibuja aquí, módulo a módulo, como
 * rectángulos vectoriales en **negro puro (K 100 %)**. Sale nítido a cualquier
 * tamaño, con una sola tinta, y sin depender de ningún perfil de color.
 *
 * ── CÓMO SE ARMA ─────────────────────────────────────────────────────────────
 *
 *   página = corte + sangrado por los cuatro lados (+ margen si hay marcas)
 *   el cartel (PNG, sin el QR) se estira para cubrir hasta el sangrado
 *   el QR se dibuja encima, vectorial, en su sitio
 *
 * El sangrado se consigue agrandando el cartel, que es lo que hacen las
 * herramientas automáticas: el diseño mide justo lo que mide el corte y no hay
 * arte de sobra que llevar al borde. Son 3 mm sobre 210, un 1,4 %: no se nota.
 * Como el cartel se agranda, la posición del QR se agranda con él —por eso se
 * recibe en FRACCIONES del lienzo y no en milímetros—, o quedaría descolocado
 * respecto al dibujo.
 */
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import sharp from 'sharp';
import * as zlib from 'zlib';
import { promisify } from 'util';

/** Asíncrono de verdad: corre en el pool de libuv, no en el hilo principal. */
const deflate = promisify(zlib.deflate);

/**
 * Píxeles por tramo antes de devolverle el control al servidor.
 *
 * Un A4 a 300 DPI son 8,7 millones de píxeles, y convertirlos de un tirón son
 * varios segundos de cálculo SÍNCRONO (medido: 6,5 s en el peor caso). Durante
 * ese tiempo el proceso no atiende a nadie: ni un sello, ni un pedido, ni un
 * login de cualquier negocio. Con tramos de 250.000 cada pausa dura unos
 * milisegundos y las demás peticiones pasan entre medias.
 */
const PIXELES_POR_TRAMO = 250_000;

/** 1 punto PostScript = 1/72 de pulgada. Los PDF se miden en puntos. */
const PUNTOS_POR_MM = 72 / 25.4;

export const SANGRADO_POR_DEFECTO_MM = 3;
/** Espacio extra fuera del sangrado para que quepan las marcas de corte. */
export const MARGEN_DE_MARCAS_MM = 5;

export type QrDelCartel = {
  /** Lo que abre el código. */
  url: string;
  /** Posición y tamaño como FRACCIÓN del lienzo (0..1). Ver la cabecera. */
  x: number;
  y: number;
  /** Lado del cuadro del QR, como fracción del ANCHO del lienzo. */
  lado: number;
  /** Módulos de zona de silencio alrededor. El editor usa 1. */
  margenEnModulos?: number;
};

export type OpcionesDeImprenta = {
  /** Tamaño FINAL, ya cortado, en milímetros. */
  mm: { w: number; h: number };
  /** El cartel rasterizado, SIN el QR. PNG o JPEG. */
  cartel: Buffer;
  qr: QrDelCartel | null;
  sangradoMm?: number;
  marcasDeCorte?: boolean;
  /**
   * «cmyk» (por defecto): el cartel se convierte a CMYK aquí. «rgb»: se deja
   * como está para que la imprenta aplique SU perfil. Ver `rgbACmyk`.
   */
  colores?: 'cmyk' | 'rgb';
  /** Solo para las pruebas: sin comprimir, los operadores de color se leen
   *  como texto y se puede comprobar que el QR sale en K 100 %. */
  comprimir?: boolean;
};

/**
 * RGB → CMYK con SUSTITUCIÓN TOTAL DE GRIS (GCR máximo).
 *
 * POR QUÉ NO `sharp.toColourspace('cmyk')`: medido, convierte el negro puro en
 * C97 M99 Y98 K97 — 391 % de tinta. Eso no es solo el QR: son TODOS los textos
 * negros del cartel. Y no se puede corregir después: sharp trata un búfer de 4
 * canales como RGBA, no como CMYK, así que no hay forma de reescribirle el negro
 * y volver a codificarlo.
 *
 * Con GCR máximo, todo lo que es gris —y el negro es el gris más oscuro— sale
 * SOLO en la tinta negra:
 *
 *     K = 1 − máx(R, G, B)
 *     C = (1 − R − K) / (1 − K)     (y lo mismo para M con G, Y con B)
 *
 *   · negro puro      → K 100 %, sin cian ni magenta ni amarillo
 *   · un gris         → solo K, sin registro que se pueda desplazar
 *   · un color vivo   → CMY y algo de K
 *
 * Y tiene una propiedad que se demuestra sola: el canal que coincide con el
 * máximo da 0, así que como mucho hay DOS de C/M/Y a la vez. La tinta total
 * nunca pasa del **300 %**, que es justo el límite de una prensa. No hace falta
 * recortar nada después.
 *
 * LO QUE NO ES: una conversión con perfil ICC. Los colores vivos no van
 * calibrados a ninguna prensa concreta. Para un cartel con un QR lo que importa
 * es el negro y los textos, y eso sale perfecto; si una imprenta pide su perfil,
 * se le manda en RGB (`colores: 'rgb'`) y lo aplica ella.
 */
export function rgbACmyk(rgb: Buffer): Buffer {
  const n = Math.floor(rgb.length / 3);
  const out = Buffer.alloc(n * 4);
  convertirTramo(rgb, out, 0, n);
  return out;
}

/** Lo mismo, cediendo el control entre tramos. Es la que usa el PDF. */
export async function rgbACmykSinBloquear(rgb: Buffer): Promise<Buffer> {
  const n = Math.floor(rgb.length / 3);
  const out = Buffer.alloc(n * 4);
  for (let desde = 0; desde < n; desde += PIXELES_POR_TRAMO) {
    convertirTramo(rgb, out, desde, Math.min(n, desde + PIXELES_POR_TRAMO));
    await new Promise((r) => setImmediate(r));
  }
  return out;
}

function convertirTramo(rgb: Buffer, out: Buffer, desde: number, hasta: number) {
  for (let i = desde; i < hasta; i++) {
    const r = rgb[i * 3] / 255;
    const g = rgb[i * 3 + 1] / 255;
    const b = rgb[i * 3 + 2] / 255;
    const k = 1 - Math.max(r, g, b);
    let c = 0;
    let m = 0;
    let y = 0;
    // Con k = 1 (negro puro) la fórmula divide por cero: ahí no hay color.
    if (k < 1) {
      c = (1 - r - k) / (1 - k);
      m = (1 - g - k) / (1 - k);
      y = (1 - b - k) / (1 - k);
    }
    // En un PDF DeviceCMYK de 8 bits, 0 = sin tinta y 255 = 100 %.
    out[i * 4] = Math.round(c * 255);
    out[i * 4 + 1] = Math.round(m * 255);
    out[i * 4 + 2] = Math.round(y * 255);
    out[i * 4 + 3] = Math.round(k * 255);
  }
}

let contadorDeImagenes = 0;

/**
 * Mete una imagen CMYK en la página como un XObject DeviceCMYK.
 *
 * PDFKit solo sabe insertar JPEG y PNG, y los dos llegan en RGB. Así que se
 * escribe el objeto a mano, igual que lo hace PDFKit por dentro
 * (`page.xobjects` + `/Label Do`). Con `Filter` ya puesto, PDFKit no lo vuelve
 * a comprimir (`PDFReference`: `compress = document.compress && !data.Filter`).
 */
function incrustarCmyk(
  doc: PDFKit.PDFDocument,
  comprimido: Buffer,
  ancho: number,
  alto: number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const d = doc as any;
  const obj = d.ref({
    Type: 'XObject',
    Subtype: 'Image',
    Width: ancho,
    Height: alto,
    ColorSpace: 'DeviceCMYK',
    BitsPerComponent: 8,
    Filter: 'FlateDecode',
  });
  obj.end(comprimido);
  const label = `ImCmyk${++contadorDeImagenes}`;
  d.page.xobjects[label] = obj;
  // La página de PDFKit tiene el eje Y invertido: por eso el alto va en
  // negativo y el origen se desplaza. Es lo mismo que hace `doc.image`.
  doc.save();
  doc.transform(w, 0, 0, -h, x, y + h);
  d.addContent(`/${label} Do`);
  doc.restore();
}

/** Dónde cae cada cosa en la página. Separado para poder probarlo solo. */
export function geometriaDeLaPagina(opts: {
  mm: { w: number; h: number };
  sangradoMm: number;
  marcasDeCorte: boolean;
}) {
  const marcas = opts.marcasDeCorte ? MARGEN_DE_MARCAS_MM : 0;
  const fuera = opts.sangradoMm + marcas;
  return {
    /** La hoja entera. */
    paginaMm: { w: opts.mm.w + fuera * 2, h: opts.mm.h + fuera * 2 },
    /** Dónde empieza el arte (incluye el sangrado). */
    arteMm: {
      x: marcas,
      y: marcas,
      w: opts.mm.w + opts.sangradoMm * 2,
      h: opts.mm.h + opts.sangradoMm * 2,
    },
    /** La línea de corte: lo que el cliente se lleva. */
    corteMm: { x: fuera, y: fuera, w: opts.mm.w, h: opts.mm.h },
  };
}

/** Los módulos oscuros del QR, como matriz de booleanos. */
export function modulosDelQr(url: string): { lado: number; oscuro: (f: number, c: number) => boolean } {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const lado = qr.modules.size;
  const data = qr.modules.data;
  return { lado, oscuro: (f, c) => !!data[f * lado + c] };
}

/**
 * El PDF, como Buffer.
 *
 * `fillColor([c,m,y,k])` de PDFKit emite DeviceCMYK de verdad, con el rango
 * 0-100 (no 0-1 ni 0-255 — no está documentado, sale de su código). Por eso el
 * QR puede ir en `[0,0,0,100]`: una sola tinta, negro plano. Comprobado en el
 * flujo que sale: `/DeviceCMYK cs` + `0 0 0 1 scn` (y `CS`/`SCN` en los
 * trazos). Ver `pdf-de-imprenta.spec.ts`.
 */
export async function construirPdfDeImprenta(opts: OpcionesDeImprenta): Promise<Buffer> {
  const sangradoMm = opts.sangradoMm ?? SANGRADO_POR_DEFECTO_MM;
  const marcasDeCorte = opts.marcasDeCorte ?? true;
  const g = geometriaDeLaPagina({ mm: opts.mm, sangradoMm, marcasDeCorte });
  const pt = (mm: number) => mm * PUNTOS_POR_MM;

  const doc = new PDFDocument({
    size: [pt(g.paginaMm.w), pt(g.paginaMm.h)],
    margin: 0,
    compress: opts.comprimir ?? true,
    // Sin esto el visor enseña «Anónimo» y la imprenta no sabe de dónde viene.
    info: { Title: 'Cartel QR', Creator: 'Clubify' },
  });

  const trozos: Buffer[] = [];
  doc.on('data', (t: Buffer) => trozos.push(t));
  const terminado = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);
  });

  // ── El cartel, cubriendo hasta el sangrado ────────────────────────────────
  if ((opts.colores ?? 'cmyk') === 'cmyk') {
    // Fondo blanco para lo transparente: en CMYK «transparente» no existe, y
    // sin aplanar, las zonas sin pintar saldrían negras.
    const { data, info } = await sharp(opts.cartel)
      .flatten({ background: '#ffffff' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Las dos piezas pesadas, sin bloquear el servidor: la conversión cede el
    // control por tramos y la compresión corre fuera del hilo principal.
    const comprimido = await deflate(await rgbACmykSinBloquear(data));
    incrustarCmyk(
      doc,
      comprimido,
      info.width,
      info.height,
      pt(g.arteMm.x),
      pt(g.arteMm.y),
      pt(g.arteMm.w),
      pt(g.arteMm.h),
    );
  } else {
    doc.image(opts.cartel, pt(g.arteMm.x), pt(g.arteMm.y), {
      width: pt(g.arteMm.w),
      height: pt(g.arteMm.h),
    });
  }

  // ── El QR, vectorial y en K 100 % ─────────────────────────────────────────
  if (opts.qr) {
    const { lado: modulos, oscuro } = modulosDelQr(opts.qr.url);
    const margen = opts.qr.margenEnModulos ?? 1;
    const total = modulos + margen * 2;

    // El cuadro del QR dentro del ARTE (que ya incluye el sangrado), porque la
    // posición viene en fracciones del lienzo y el lienzo se estiró con él.
    const cajaX = g.arteMm.x + opts.qr.x * g.arteMm.w;
    const cajaY = g.arteMm.y + opts.qr.y * g.arteMm.h;
    const cajaLado = opts.qr.lado * g.arteMm.w;
    const modMm = cajaLado / total;

    // Fondo blanco del QR: la zona de silencio tiene que ser BLANCA de verdad,
    // no «lo que hubiera debajo». Sin esto, un cartel con fondo oscuro deja el
    // código sin contraste y no se lee.
    doc.fillColor([0, 0, 0, 0]).rect(pt(cajaX), pt(cajaY), pt(cajaLado), pt(cajaLado)).fill();

    // TODO EL QR EN UN SOLO RELLENO, y los módulos contiguos de cada fila
    // unidos en un único rectángulo.
    //
    // Visto en la muestra renderizada: dibujando cada módulo como un rectángulo
    // con su propio `fill`, el suavizado deja CUSTURAS finas entre módulos
    // vecinos —una rejilla de hilos claros sobre todo el código—. En la prensa
    // casi nunca se ve, pero en la vista previa sí, y es lo primero que mira el
    // cliente antes de mandarlo. Con un solo relleno las aristas compartidas no
    // existen: se pinta la unión. Y unir las rachas deja el PDF mucho más
    // ligero (de ~800 rectángulos a unas pocas decenas por fila).
    doc.fillColor([0, 0, 0, 100]);
    for (let f = 0; f < modulos; f++) {
      let c = 0;
      while (c < modulos) {
        if (!oscuro(f, c)) {
          c++;
          continue;
        }
        const inicio = c;
        while (c < modulos && oscuro(f, c)) c++;
        doc.rect(
          pt(cajaX + (inicio + margen) * modMm),
          pt(cajaY + (f + margen) * modMm),
          pt((c - inicio) * modMm),
          // Un pelo más alto: solapa con la fila de abajo, así tampoco queda
          // hilo entre filas.
          pt(modMm) + 0.05,
        );
      }
    }
    doc.fill();
  }

  // ── Marcas de corte ───────────────────────────────────────────────────────
  if (marcasDeCorte) {
    const largo = pt(MARGEN_DE_MARCAS_MM - 1);
    const sep = pt(1);
    const x0 = pt(g.corteMm.x);
    const y0 = pt(g.corteMm.y);
    const x1 = pt(g.corteMm.x + g.corteMm.w);
    const y1 = pt(g.corteMm.y + g.corteMm.h);
    // En K 100 %: una marca de corte en cuatro tintas se ve borrosa y es justo
    // la referencia que usa la guillotina.
    doc.strokeColor([0, 0, 0, 100]).lineWidth(0.25);
    const linea = (ax: number, ay: number, bx: number, by: number) =>
      doc.moveTo(ax, ay).lineTo(bx, by).stroke();
    for (const [x, dx] of [[x0, -1], [x1, 1]] as const) {
      for (const [y, dy] of [[y0, -1], [y1, 1]] as const) {
        linea(x, y + dy * sep, x, y + dy * (sep + largo));
        linea(x + dx * sep, y, x + dx * (sep + largo), y);
      }
    }
  }

  doc.end();
  return terminado;
}
