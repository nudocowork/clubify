import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { detectarFormato } from './detectar-formato';
import { ArchivoRechazado, claveDeVariante, procesarImagen } from './procesar-imagen';
import {
  MB,
  mensajeDePesoExcedido,
  pesoLegible,
  POLITICA,
  resolverUso,
  type PoliticaDeImagen,
} from './politica-de-archivos';

const P = (u: keyof typeof POLITICA) => POLITICA[u] as PoliticaDeImagen;

async function foto(w: number, h: number, semilla = 0): Promise<Buffer> {
  // Ruido: una imagen lisa comprime a nada y no prueba el tamaño real.
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919 + semilla * 97) % 251;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

/** PNG que solo tiene la cabecera: declara dimensiones sin píxeles detrás. */
function pngQueDeclara(w: number, h: number): Buffer {
  const chunk = (tipo: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(tipo, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function rechazo(p: Promise<unknown>): Promise<ArchivoRechazado> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ArchivoRechazado) return e;
    throw e;
  }
  throw new Error('se esperaba un rechazo y se aceptó');
}

describe('política de archivos', () => {
  it('pesos en unidades decimales y mensaje exacto en español', () => {
    expect(MB).toBe(1_000_000);
    expect(pesoLegible(9_200_000)).toBe('9,2 MB');
    expect(pesoLegible(8_000_000)).toBe('8 MB');
    expect(pesoLegible(850_000)).toBe('850 KB');
    expect(
      mensajeDePesoExcedido({ bytes: 9_200_000, maximo: 8 * MB, etiqueta: P('BANNER').etiqueta }),
    ).toBe(
      'Esta imagen pesa 9,2 MB. El máximo permitido para banners es 8 MB. Reduce su tamaño o selecciona otra imagen.',
    );
  });

  it('el uso manda sobre la carpeta; la carpeta sola también tiene reglas', () => {
    expect(resolverUso({ uso: 'banner', folder: 'products' })).toBe('BANNER');
    expect(resolverUso({ folder: 'menu-book' })).toBe('PAGINA_LIBRO');
    expect(resolverUso({ folder: 'storefront-bg' })).toBe('FONDO');
    expect(resolverUso({ folder: 'carpeta-nueva' })).toBe('ADJUNTO');
    expect(resolverUso({ uso: 'NO_EXISTE' })).toBeNull();
  });

  it('todos los anchos de variante son de los que acepta el optimizador de Next', () => {
    // deviceSizes + imageSizes por defecto: otro ancho responde 400 y la imagen sale en blanco.
    const permitidos = new Set([16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840]);
    for (const [uso, p] of Object.entries(POLITICA)) {
      if (p.tipo !== 'imagen') continue;
      for (const w of p.anchosVariantes) expect(permitidos.has(w), `${uso} ${w}`).toBe(true);
    }
  });
});

describe('detectarFormato (magic bytes)', () => {
  it('reconoce por contenido y no por extensión', async () => {
    expect(detectarFormato(await foto(10, 10))).toBe('jpeg');
    expect(detectarFormato(Buffer.from('%PDF-1.7\n...'))).toBe('pdf');
    expect(detectarFormato(Buffer.from('<html><script>alert(1)</script>'))).toBe('desconocido');
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(8)]);
    expect(detectarFormato(heic)).toBe('heic');
  });
});

describe('procesarImagen', () => {
  const chica: PoliticaDeImagen = { ...P('BANNER'), maxBytesOriginal: 20_000 };

  it('acepta el límite exacto y rechaza 1 byte por encima', async () => {
    const img = await foto(64, 64);
    await expect(procesarImagen(img, { ...chica, maxBytesOriginal: img.length })).resolves.toBeTruthy();
    const r = await rechazo(procesarImagen(img, { ...chica, maxBytesOriginal: img.length - 1 }));
    expect(r.motivo).toBe('peso');
    expect(r.message).toMatch(/^Esta imagen pesa .* El máximo permitido para banners es/);
  });

  it('rechaza un archivo con extensión engañosa (HTML llamado .jpg) y HEIC con su explicación', async () => {
    const r = await rechazo(procesarImagen(Buffer.from('<html>hola</html> '.repeat(10)), chica));
    expect(r.motivo).toBe('formato');
    expect(r.message).toContain('no coincide con su extensión');
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(64)]);
    expect((await rechazo(procesarImagen(heic, chica))).message).toContain('HEIC');
  });

  it('rechaza un archivo corrupto (JPEG truncado) y no devuelve nada que publicar', async () => {
    const img = await foto(400, 400);
    const truncado = img.subarray(0, Math.floor(img.length / 2));
    const r = await rechazo(procesarImagen(truncado, P('PRODUCTO')));
    expect(r.motivo).toBe('corrupto');
  });

  it('una bomba de píxeles se rechaza antes de decodificarla', async () => {
    const lado = await rechazo(procesarImagen(pngQueDeclara(100_000, 100_000), P('PRODUCTO')));
    // sharp ya se niega al leer la cabecera (límite de píxeles) o lo para el
    // tope de lado: cualquiera de los dos, pero sin reservar la memoria.
    expect(['dimensiones', 'megapixeles']).toContain(lado.motivo);
    const mp = await rechazo(procesarImagen(pngQueDeclara(8_000, 8_000), P('PRODUCTO')));
    expect(mp.motivo).toBe('megapixeles');
  });

  it('PNG con transparencia: WebP con alfa en la web, PNG en usos «compatibles»', async () => {
    const png = await sharp({
      create: { width: 300, height: 200, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: await foto(100, 100), left: 100, top: 50 }])
      .png()
      .toBuffer();
    const web = await procesarImagen(png, P('PORTADA'));
    expect(web.maestro.contentType).toBe('image/webp');
    expect(web.maestro.tieneAlfa).toBe(true);
    const logo = await procesarImagen(png, P('LOGO'));
    expect(logo.maestro.contentType).toBe('image/png');
    expect(logo.maestro.tieneAlfa).toBe(true);
  });

  it('un PNG con alfa pero todo opaco sale como JPEG en usos compatibles', async () => {
    const png = await sharp(await foto(200, 200)).ensureAlpha().png().toBuffer();
    const r = await procesarImagen(png, P('LOGO'));
    expect(r.maestro.contentType).toBe('image/jpeg');
  });

  it('corrige la orientación EXIF y quita los metadatos', async () => {
    // 200×100 guardada «acostada» con orientación 6 (girar 90°): se ve 100×200.
    const girada = await sharp(await foto(200, 100)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const r = await procesarImagen(girada, P('PRODUCTO'));
    expect([r.maestro.ancho, r.maestro.alto]).toEqual([100, 200]);
    const m = await sharp(r.maestro.buffer).metadata();
    expect(m.orientation ?? 1).toBe(1);
    expect(m.exif).toBeUndefined();
  });

  it('reduce al lado del maestro y nunca amplía', async () => {
    const grande = await procesarImagen(await foto(3000, 1500), P('PRODUCTO'));
    expect(Math.max(grande.maestro.ancho, grande.maestro.alto)).toBe(P('PRODUCTO').ladoMaestro);
    const pequena = await procesarImagen(await foto(300, 200), P('PRODUCTO'));
    expect([pequena.maestro.ancho, pequena.maestro.alto]).toEqual([300, 200]);
  });

  it('página del libro: miniaturas reales de 80 y 160 px dentro de su presupuesto', async () => {
    const r = await procesarImagen(await foto(1240, 1754), P('PAGINA_LIBRO'));
    expect(r.variantes.map((v) => v.ancho)).toEqual([80, 160]);
    for (const v of r.variantes) {
      expect(v.buffer.length).toBeLessThanOrEqual(P('PAGINA_LIBRO').presupuestoVariante);
    }
    expect(claveDeVariante('t/menu-book/abc.webp', 160)).toBe('t/menu-book/abc.w160.webp');
  });

  it('el nombre es el hash del contenido: misma imagen, misma clave', async () => {
    const img = await foto(120, 80);
    const a = await procesarImagen(img, P('PRODUCTO'));
    const b = await procesarImagen(img, P('PRODUCTO'));
    expect(a.maestro.hash).toBe(b.maestro.hash);
    expect(a.maestro.hash).toMatch(/^[0-9a-f]{20}$/);
  });

  it('un GIF animado se conserva animado (WebP) donde el uso lo admite', async () => {
    // Cuadros distintos: el codificador GIF funde los idénticos en uno.
    const frames = await Promise.all([0, 1, 2].map((i) => foto(60, 40, i + 1)));
    const raw = await sharp(frames, { join: { animated: true } }).gif().toBuffer();
    const r = await procesarImagen(raw, P('PRODUCTO'));
    expect(r.maestro.animada).toBe(true);
    expect((await sharp(r.maestro.buffer, { animated: true }).metadata()).pages).toBe(3);
    // Un banner no admite GIF.
    expect((await rechazo(procesarImagen(raw, P('BANNER')))).motivo).toBe('formato');
  });
});
