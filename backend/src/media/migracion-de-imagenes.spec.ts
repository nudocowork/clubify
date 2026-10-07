import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  agrupar,
  ejecutar,
  ESTADOS_FINALES,
  migrarRecurso,
  revertirEntrada,
  sqlDeActualizacion,
  yaMigrada,
  type Dependencias,
  type EntradaDeRegistro,
  type Referencia,
} from './migracion-de-imagenes';

const BUCKET = 'https://pub-6de3a37544604346a69b9836aed1c6cf.r2.dev';

async function pngPesado(semilla = 1): Promise<Buffer> {
  const w = 900;
  const h = 700;
  const raw = Buffer.alloc(w * h * 3);
  let x = 12345 + semilla;
  for (let i = 0; i < raw.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = (x >> 16) & 255;
  }
  // Ruido suavizado: parece una foto (el PNG sin pérdida pesa, el WebP no),
  // que es justo el caso que la migración tiene que resolver.
  const suave = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).blur(3).raw().toBuffer();
  return sharp(suave, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

/**
 * Bucket y base de mentira. La «base» es un mapa fila → valor; `actualizar`
 * es el UPDATE condicional (solo cambia si la fila aún vale `anterior`).
 */
function dobles(originales: Record<string, Buffer>, filas: Record<string, string>) {
  const bucket = new Map<string, Buffer>();
  const subidas: string[] = [];
  const registro: EntradaDeRegistro[] = [];
  const deps: Dependencias = {
    async descargar(url) {
      const b = originales[url] ?? bucket.get(url.replace(`${BUCKET}/`, ''));
      if (!b) throw new Error(`404 ${url}`);
      return b;
    },
    async existe(key) {
      return bucket.get(key)?.length ?? null;
    },
    async subir(key, body) {
      subidas.push(key);
      bucket.set(key, body);
    },
    urlPublica: (key) => `${BUCKET}/${key}`,
    async actualizar(ref, anterior, nueva) {
      const k = `${ref.tabla}.${ref.columna}.${ref.id}`;
      if (filas[k] !== anterior) return 0;
      filas[k] = nueva;
      return 1;
    },
    async registrar(e) {
      registro.push(e);
    },
  };
  return { deps, bucket, subidas, registro, filas };
}

const ref = (o: Partial<Referencia>): Referencia => ({
  tenantId: 't1',
  negocio: 'konys',
  tabla: 'Product',
  columna: 'imageUrl',
  ruta: null,
  id: 'p1',
  uso: 'PRODUCTO',
  url: `${BUCKET}/t1/products/abcDEF123xyz7890.png`,
  bytes: 1000,
  prioridadNegocio: 0,
  ...o,
});

describe('migración de imágenes existentes', () => {
  it('agrupa por negocio + URL y ordena activos primero y luego por impacto', () => {
    const url = `${BUCKET}/x/a.png`;
    const recs = agrupar([
      ref({ url, tenantId: 't1', id: 'a' }),
      ref({ url, tenantId: 't1', id: 'b' }),
      ref({ url, tenantId: 't2', id: 'c' }), // otro negocio, MISMA url → otro recurso
      ref({ url: `${BUCKET}/x/fondo.png`, uso: 'FONDO', tenantId: 't3', bytes: 500, prioridadNegocio: 2 }),
    ]);
    expect(recs).toHaveLength(3);
    expect(recs.find((r) => r.tenantId === 't1')?.referencias).toHaveLength(2);
    expect(recs[recs.length - 1].tenantId).toBe('t3'); // suspendido al final
  });

  it('aplicar: clave nueva, original intacto, referencias con UPDATE condicional', async () => {
    const r0 = ref({});
    const d = dobles({ [r0.url]: await pngPesado() }, { 'Product.imageUrl.p1': r0.url });
    const [rec] = agrupar([r0]);
    const e = await migrarRecurso(rec, d.deps, { modo: 'aplicar', lote: 'l1' });
    expect(e.estado).toBe('aplicado');
    expect(e.urlNueva).not.toBe(r0.url);
    expect(yaMigrada(e.urlNueva!)).toBe(true);
    expect(d.filas['Product.imageUrl.p1']).toBe(e.urlNueva);
    expect(e.bytesDespues!).toBeLessThan(e.bytesAntes!);
    // Nunca se sube nada con la clave del original.
    expect(d.subidas.some((k) => r0.url.endsWith(k))).toBe(false);
  });

  it('idempotente: la segunda pasada no sube ni duplica, y una URL ya migrada se salta', async () => {
    const r0 = ref({});
    const d = dobles({ [r0.url]: await pngPesado() }, { 'Product.imageUrl.p1': r0.url });
    const [rec] = agrupar([r0]);
    const e1 = await migrarRecurso(rec, d.deps, { modo: 'aplicar', lote: 'l1' });
    const subidasTrasLaPrimera = d.subidas.length;
    // Otra corrida sobre el mismo original (la fila ya apunta al derivado).
    const e2 = await migrarRecurso(rec, d.deps, { modo: 'aplicar', lote: 'l1' });
    expect(d.subidas.length).toBe(subidasTrasLaPrimera); // existe con el mismo tamaño → no se sube
    expect(e2.urlNueva).toBe(e1.urlNueva);
    expect(e2.referenciasActualizadas).toBe(0); // la fila ya no vale la URL vieja
    const [yaNueva] = agrupar([ref({ url: e1.urlNueva! })]);
    expect((await migrarRecurso(yaNueva, d.deps, { modo: 'aplicar', lote: 'l1' })).estado).toBe('ya-migrado');
  });

  it('si el negocio cambió la imagen mientras corría, no se le pisa', async () => {
    const r0 = ref({});
    const d = dobles({ [r0.url]: await pngPesado() }, { 'Product.imageUrl.p1': `${BUCKET}/t1/products/la-que-subio-hoy.webp` });
    const [rec] = agrupar([r0]);
    const e = await migrarRecurso(rec, d.deps, { modo: 'aplicar', lote: 'l1' });
    expect(e.referenciasActualizadas).toBe(0);
    expect(d.filas['Product.imageUrl.p1']).toContain('la-que-subio-hoy');
    expect(e.motivo).toContain('no se tocaron');
  });

  it('reanudación: lo terminado se salta y un fallo no detiene a los demás negocios', async () => {
    const a = ref({ id: 'a', tenantId: 'ta', url: `${BUCKET}/ta/products/aaaaaaaaaaaaaaaa.png` });
    const b = ref({ id: 'b', tenantId: 'tb', url: `${BUCKET}/tb/products/bbbbbbbbbbbbbbbb.png` });
    const c = ref({ id: 'c', tenantId: 'tc', url: `${BUCKET}/tc/products/cccccccccccccccc.png` });
    const d = dobles(
      { [a.url]: await pngPesado(1), [c.url]: await pngPesado(3) }, // b no existe → error
      { 'Product.imageUrl.a': a.url, 'Product.imageUrl.b': b.url, 'Product.imageUrl.c': c.url },
    );
    const recs = agrupar([a, b, c]);
    const primera = await ejecutar(recs, d.deps, { modo: 'aplicar', lote: 'l1', concurrencia: 2 });
    const porTenant = Object.fromEntries(primera.map((e) => [e.tenantId, e.estado]));
    expect(porTenant).toEqual({ ta: 'aplicado', tb: 'error', tc: 'aplicado' });
    const hechas = new Set(primera.filter((e) => ESTADOS_FINALES.has(e.estado)).map((e) => e.clave));
    const segunda = await ejecutar(recs, d.deps, { modo: 'aplicar', lote: 'l1', hechas });
    expect(segunda.map((e) => e.tenantId)).toEqual(['tb']); // solo se reintenta el que falló
  });

  it('revertir devuelve la URL anterior solo donde sigue la nueva', async () => {
    const r1 = ref({ id: 'p1' });
    const r2 = ref({ id: 'p2' });
    const d = dobles({ [r1.url]: await pngPesado() }, { 'Product.imageUrl.p1': r1.url, 'Product.imageUrl.p2': r1.url });
    const [rec] = agrupar([r1, r2]);
    const e = await migrarRecurso(rec, d.deps, { modo: 'aplicar', lote: 'l1' });
    expect(e.referenciasActualizadas).toBe(2);
    d.filas['Product.imageUrl.p2'] = `${BUCKET}/t1/products/otra-nueva.webp`; // el negocio la cambió
    const rev = await revertirEntrada(e, d.deps, 'l1.revertido');
    expect(rev.estado).toBe('revertido');
    expect(d.filas['Product.imageUrl.p1']).toBe(r1.url);
    expect(d.filas['Product.imageUrl.p2']).toContain('otra-nueva');
    expect(rev.referenciasActualizadas).toBe(1);
    // El derivado sigue en el bucket (no se borra nada).
    expect(d.bucket.has(e.claveNueva!)).toBe(true);
  });

  it('un PDF guardado como imagen queda para revisión manual, sin derivado', async () => {
    const r0 = ref({ uso: 'BANNER', tabla: 'Storefront', columna: 'heroImageUrl' });
    const d = dobles({ [r0.url]: Buffer.from('%PDF-1.6\n…') }, { 'Storefront.heroImageUrl.p1': r0.url });
    const [rec] = agrupar([r0]);
    const e = await migrarRecurso(rec, d.deps, { modo: 'aplicar', lote: 'l1' });
    expect(e.estado).toBe('revision-manual');
    expect(e.motivo).toContain('PDF');
    expect(d.subidas).toHaveLength(0);
  });

  it('simular no sube ni escribe en la base', async () => {
    const r0 = ref({});
    const d = dobles({ [r0.url]: await pngPesado() }, { 'Product.imageUrl.p1': r0.url });
    d.deps.subir = async () => {
      throw new Error('no debía subir');
    };
    d.deps.actualizar = async () => {
      throw new Error('no debía escribir');
    };
    const [rec] = agrupar([r0]);
    const e = await migrarRecurso(rec, d.deps, { modo: 'simular', lote: 's' });
    expect(e.estado).toBe('simulado');
    expect(d.filas['Product.imageUrl.p1']).toBe(r0.url);
  });

  it('una URL de fuera de nuestro bucket no se toca', async () => {
    const [rec] = agrupar([ref({ url: 'https://images.unsplash.com/photo-1' })]);
    const d = dobles({}, {});
    expect((await migrarRecurso(rec, d.deps, { modo: 'simular', lote: 's' })).estado).toBe('externa');
  });

  it('el SQL sale solo de la lista de columnas y es condicional', () => {
    expect(sqlDeActualizacion({ tabla: 'Product', columna: 'imageUrl', ruta: null })).toBe(
      'UPDATE "Product" SET "imageUrl" = $2 WHERE id = $1 AND "imageUrl" = $3',
    );
    expect(sqlDeActualizacion({ tabla: 'Category', columna: 'coverConfig', ruta: 'bgImageUrl' })).toContain(
      `"coverConfig"->>'bgImageUrl' = $3`,
    );
    expect(sqlDeActualizacion({ tabla: 'User', columna: 'password', ruta: null })).toBeNull();
  });
});
