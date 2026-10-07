import { detectarFormato } from './detectar-formato';
import { ArchivoRechazado, procesarImagen, type ResultadoDeProcesar } from './procesar-imagen';
import {
  mensajeDePesoExcedido,
  POLITICA,
  type PoliticaDeImagen,
  type PoliticaDePdf,
} from './politica-de-archivos';

/**
 * Importa el PDF de un menú libro como PÁGINAS: cada página se rasteriza por
 * separado y pasa por la misma política que una página subida como imagen
 * (`PAGINA_LIBRO`), con sus miniaturas.
 *
 * Por qué así y no guardando el PDF: el visor del libro pinta imágenes, y un
 * PDF de 20 MB obligaría al cliente a bajarse la carta entera para ver la
 * portada. Aquí el PDF NUNCA se guarda: se lee, se trocea y se descarta.
 *
 * Límites (en `POLITICA.PDF_MENU`): peso, número de páginas, tiempo total y por
 * página, y UNA importación a la vez por instancia —la hace cumplir el
 * servicio—, porque rasterizar es la operación más cara en CPU y memoria que
 * hace el backend y dos a la vez en el contenedor de Railway compiten con las
 * peticiones del menú. Se rasteriza de a UNA página: la memoria máxima es la de
 * un lienzo (≈ 2048 × 2900 × 4 B ≈ 24 MB), no la del documento entero.
 */
export interface PaginaImportada {
  numero: number;
  resultado: ResultadoDeProcesar;
}

/** Lo mínimo de pdf-parse que se usa, para poder sustituirlo en las pruebas. */
export interface LectorDePdf {
  total(): Promise<number>;
  renderizar(pagina: number, ancho: number): Promise<Buffer>;
  cerrar(): Promise<void>;
}

export async function lectorPdfParse(buffer: Buffer): Promise<LectorDePdf> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new (PDFParse as any)({ data: new Uint8Array(buffer) });
  return {
    async total() {
      const info = await parser.getInfo();
      return Number(info?.total ?? 0);
    },
    async renderizar(pagina, ancho) {
      const r = await parser.getScreenshot({ partial: [pagina], desiredWidth: ancho, imageBuffer: true });
      const p = r?.pages?.[0];
      if (!p?.data?.length) throw new Error('página vacía');
      return Buffer.from(p.data);
    },
    async cerrar() {
      await parser.destroy?.();
    },
  };
}

function conTiempo<T>(p: Promise<T>, ms: number, mensaje: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<T>((_, rej) => {
      t = setTimeout(() => rej(new ArchivoRechazado(mensaje, 'procesamiento')), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

export async function importarPdf(
  buffer: Buffer,
  opts: {
    politica?: PoliticaDePdf;
    abrir?: (b: Buffer) => Promise<LectorDePdf>;
    ahora?: () => number;
  } = {},
): Promise<{ paginas: PaginaImportada[]; total: number }> {
  const politica = opts.politica ?? (POLITICA.PDF_MENU as PoliticaDePdf);
  const politicaPagina = POLITICA[politica.usoDePagina] as PoliticaDeImagen;
  const ahora = opts.ahora ?? Date.now;

  if (buffer.length > politica.maxBytesOriginal) {
    throw new ArchivoRechazado(
      mensajeDePesoExcedido({
        bytes: buffer.length,
        maximo: politica.maxBytesOriginal,
        etiqueta: politica.etiqueta,
        esImagen: false,
      }),
      'peso',
    );
  }
  if (detectarFormato(buffer) !== 'pdf') {
    throw new ArchivoRechazado(
      'El archivo no es un PDF válido (su contenido no coincide con su extensión).',
      'formato',
    );
  }

  const inicio = ahora();
  let lector: LectorDePdf;
  try {
    lector = await (opts.abrir ?? lectorPdfParse)(buffer);
  } catch {
    throw new ArchivoRechazado(
      'No pudimos abrir el PDF: parece dañado o protegido con contraseña.',
      'corrupto',
    );
  }
  try {
    let total: number;
    try {
      total = await conTiempo(lector.total(), politica.tiempoPorPaginaMs, 'El PDF tardó demasiado en abrirse.');
    } catch (e) {
      if (e instanceof ArchivoRechazado) throw e;
      throw new ArchivoRechazado(
        'No pudimos abrir el PDF: parece dañado o protegido con contraseña.',
        'corrupto',
      );
    }
    if (!total) throw new ArchivoRechazado('El PDF no tiene páginas.', 'corrupto');
    if (total > politica.paginasMaximas) {
      throw new ArchivoRechazado(
        `El PDF tiene ${total} páginas. El máximo para importar es ${politica.paginasMaximas}. ` +
          'Divídelo en dos archivos o sube las páginas como imágenes.',
        'dimensiones',
      );
    }

    const paginas: PaginaImportada[] = [];
    for (let n = 1; n <= total; n++) {
      if (ahora() - inicio > politica.tiempoMaximoMs) {
        throw new ArchivoRechazado(
          `El PDF tardó demasiado en procesarse (se alcanzaron ${n - 1} de ${total} páginas). ` +
            'Divídelo en archivos más pequeños.',
          'procesamiento',
        );
      }
      const png = await conTiempo(
        lector.renderizar(n, politica.anchoDeRender),
        politica.tiempoPorPaginaMs,
        `La página ${n} del PDF tardó demasiado en procesarse.`,
      ).catch((e) => {
        if (e instanceof ArchivoRechazado) throw e;
        throw new ArchivoRechazado(`No pudimos leer la página ${n} del PDF.`, 'corrupto');
      });
      // La página rasterizada es un PNG grande pero sin tope de «original»: el
      // tope que cuenta es el del PDF. Se procesa con la política de página
      // salvo ese límite de peso.
      const resultado = await procesarImagen(png, {
        ...politicaPagina,
        maxBytesOriginal: Number.MAX_SAFE_INTEGER,
      });
      // Se acumulan en memoria (≈ 300 KB por página) y el servicio las sube al
      // final: si la página 7 falla no queda media carta publicada.
      paginas.push({ numero: n, resultado });
    }
    return { paginas, total };
  } finally {
    await lector.cerrar().catch(() => undefined);
  }
}
