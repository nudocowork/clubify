import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importarPdf, type LectorDePdf } from './importar-pdf';
import { MediaService } from './media.service';
import { ArchivoRechazado } from './procesar-imagen';
import { POLITICA, type PoliticaDePdf } from './politica-de-archivos';

function archivo(buffer: Buffer, mimetype: string, originalname = 'x'): Express.Multer.File {
  return { buffer, mimetype, originalname, size: buffer.length } as Express.Multer.File;
}

async function jpeg(w = 400, h = 300, semilla = 1) {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + semilla) % 251;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
}

describe('MediaService.upload (almacenamiento simulado)', () => {
  let svc: MediaService;
  let enviados: Array<{ Key: string; ContentType: string; Body: Buffer }>;
  let fallar = false;

  beforeEach(() => {
    svc = new MediaService();
    enviados = [];
    fallar = false;
    (svc as any).s3 = {
      send: vi.fn(async (cmd: any) => {
        if (fallar) throw Object.assign(new Error('caído'), { name: 'NetworkError' });
        enviados.push(cmd.input);
      }),
    };
  });

  it('página de libro: sube miniaturas y maestro con clave por hash; responde variantes', async () => {
    const r = await svc.upload({ tenantId: 't1', folder: 'menu-book', file: archivo(await jpeg(1240, 1754), 'image/jpeg') });
    expect(r.uso).toBe('PAGINA_LIBRO');
    expect(r.key).toMatch(/^t1\/menu-book\/[0-9a-f]{20}\.webp$/);
    expect(Object.keys(r.variantes)).toEqual(['80', '160']);
    expect(enviados.map((e) => e.Key)).toEqual([
      r.key.replace('.webp', '.w80.webp'),
      r.key.replace('.webp', '.w160.webp'),
      r.key,
    ]);
  });

  it('si el almacenamiento falla, error claro y ninguna URL', async () => {
    fallar = true;
    await expect(
      svc.upload({ folder: 'products', file: archivo(await jpeg(), 'image/jpeg') }),
    ).rejects.toThrow(/No se publicó nada/);
  });

  it('un PDF con extensión .jpg en una carpeta de imágenes se rechaza; en adjuntos pasa como PDF', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%falso pero con cabecera\n');
    await expect(
      svc.upload({ folder: 'products', file: archivo(pdf, 'image/jpeg', 'foto.jpg') }),
    ).rejects.toThrow(/no coincide con su extensión/);
    const r = await svc.upload({ folder: 'data-policy', file: archivo(pdf, 'application/pdf', 'politica.pdf') });
    expect(r.contentType).toBe('application/pdf');
    expect(r.key).toMatch(/\.pdf$/);
  });

  it('adjunto: un .m4a (contenedor MP4) declarado como audio queda como audio', async () => {
    const m4a = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(64)]);
    const r = await svc.upload({ folder: 'crm-buttons', file: archivo(m4a, 'audio/x-m4a', 'nota.m4a') });
    expect(r.category).toBe('audio');
    expect(r.key).toMatch(/\.m4a$/);
  });

  it('adjunto: un ejecutable renombrado a .mp3 se rechaza', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);
    await expect(
      svc.upload({ folder: 'crm-buttons', file: archivo(exe, 'audio/mpeg', 'cancion.mp3') }),
    ).rejects.toThrow(/no coincide/);
  });

  it('peso de más responde 413 con el mensaje de la política', async () => {
    const img = await jpeg();
    const grande = Buffer.concat([img, Buffer.alloc(POLITICA.LOGO.maxBytesOriginal)]);
    await expect(svc.upload({ folder: 'logos', file: archivo(grande, 'image/png') })).rejects.toMatchObject({
      status: 413,
      message: expect.stringContaining('El máximo permitido para logos es 2 MB'),
    });
  });

  it('carpeta con ../ se rechaza', async () => {
    await expect(
      svc.upload({ folder: '../otro-negocio', uso: 'PRODUCTO', file: archivo(await jpeg(), 'image/jpeg') }),
    ).rejects.toThrow(/Carpeta de destino inválida/);
  });

  it('uso inexistente se rechaza en vez de adivinar', async () => {
    await expect(svc.upload({ uso: 'CUALQUIERA', file: archivo(await jpeg(), 'image/jpeg') })).rejects.toThrow(
      /Uso de archivo desconocido/,
    );
  });
});

describe('importarPdf (límites)', () => {
  const pdf = Buffer.from('%PDF-1.7\n');
  const lector = (total: number, renderizar?: LectorDePdf['renderizar']): LectorDePdf => ({
    total: async () => total,
    renderizar: renderizar ?? (async () => jpeg(800, 1100)),
    cerrar: async () => undefined,
  });
  const pol = POLITICA.PDF_MENU as PoliticaDePdf;

  it('cada página sale optimizada aparte con sus miniaturas', async () => {
    const r = await importarPdf(pdf, { abrir: async () => lector(3) });
    expect(r.paginas).toHaveLength(3);
    for (const p of r.paginas) {
      expect(p.resultado.maestro.contentType).toBe('image/webp');
      expect(p.resultado.variantes.map((v) => v.ancho)).toEqual([80, 160]);
    }
  });

  it('rechaza más páginas que el máximo, sin rasterizar ninguna', async () => {
    const renderizar = vi.fn();
    const e = await importarPdf(pdf, { abrir: async () => lector(pol.paginasMaximas + 1, renderizar) }).catch((x) => x);
    expect(e).toBeInstanceOf(ArchivoRechazado);
    expect(e.message).toContain(`El máximo para importar es ${pol.paginasMaximas}`);
    expect(renderizar).not.toHaveBeenCalled();
  });

  it('corta por tiempo total', async () => {
    let t = 0;
    const e = await importarPdf(pdf, {
      abrir: async () => lector(5),
      ahora: () => (t += pol.tiempoMaximoMs),
    }).catch((x) => x);
    expect(e).toBeInstanceOf(ArchivoRechazado);
    expect(e.message).toContain('tardó demasiado');
  });

  it('un archivo que no es PDF se rechaza por contenido', async () => {
    const e = await importarPdf(await jpeg(), {}).catch((x) => x);
    expect(e.message).toContain('no es un PDF válido');
  });
});

describe('importarPdf con pdf-parse de verdad', () => {
  it('rasteriza un PDF real de 3 páginas y deja el texto legible (ancho de lectura)', async () => {
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ size: 'A4' });
    const trozos: Buffer[] = [];
    doc.on('data', (c: Buffer) => trozos.push(c));
    const fin = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(trozos))));
    for (let i = 0; i < 3; i++) {
      if (i) doc.addPage();
      doc.fontSize(28).text(`Hamburguesa doble  $ 28.000 — página ${i + 1}`, 60, 200);
    }
    doc.end();
    const r = await importarPdf(await fin);
    expect(r.total).toBe(3);
    const m = r.paginas[0].resultado.maestro;
    // Se rasteriza a 2048 de ancho y el maestro cabe en 2560 de lado: un A4
    // queda en ~1810 × 2560 (≈ 220 ppp), de sobra para leer y hacer zoom.
    expect(m.alto).toBe((POLITICA.PAGINA_LIBRO as { ladoMaestro: number }).ladoMaestro);
    expect(m.ancho).toBeGreaterThan(1700);
    expect(r.paginas[0].resultado.variantes.map((v) => v.ancho)).toEqual([80, 160]);
  }, 60_000);
});
