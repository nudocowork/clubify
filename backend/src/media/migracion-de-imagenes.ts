/**
 * Núcleo de la MIGRACIÓN de imágenes existentes a la política por uso.
 *
 * El CLI es `scripts/optimizar-imagenes-existentes.cjs`; aquí vive la lógica,
 * sin base ni bucket: todo lo de fuera llega por `Dependencias`, así se prueba
 * con dobles y la simulación local usa el mismo código que la aplicación.
 *
 * Reglas que no se rompen (por qué cada una):
 *  - NUNCA se sobrescribe ni se borra un original: el derivado va a una clave
 *    NUEVA (hash del contenido). Revertir es devolver la URL vieja, que sigue
 *    existiendo.
 *  - Una referencia se actualiza con UPDATE CONDICIONAL («donde la columna
 *    todavía vale la URL vieja») y se mira cuántas filas cambió: si el negocio
 *    cambió la imagen mientras corría la migración, no se le pisa.
 *  - Un fallo se anota y se sigue: un negocio no detiene a otro, y un recurso
 *    no toca nunca referencias de otro negocio (se agrupa por negocio + URL).
 *  - Idempotente: una URL que ya tiene forma de la política nueva, o un
 *    recurso ya terminado en el registro, no se vuelve a procesar; y como la
 *    clave es el hash, repetir no duplica objetos.
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { detectarFormato } from './detectar-formato';
import { ArchivoRechazado, claveDeVariante, procesarImagen } from './procesar-imagen';
import {
  CARPETA_POR_USO,
  POLITICA,
  type PoliticaDeImagen,
  type Uso,
} from './politica-de-archivos';

export interface Referencia {
  tenantId: string | null;
  negocio: string | null;
  /** Tabla y columna en la base (null si viene del inventario público). */
  tabla: string | null;
  columna: string | null;
  /** Clave dentro de una columna JSON (`coverConfig` → `bgImageUrl`). */
  ruta: string | null;
  id: string | null;
  uso: Uso;
  url: string;
  bytes?: number | null;
  /** 0 = activo y publicado (primero) … 3 = suspendido/borrado (último). */
  prioridadNegocio: number;
  /** Lo que pesa hoy lo que ve el cliente (del inventario), para el informe. */
  pesoServidoHoy?: number | null;
}

export interface Recurso {
  clave: string;
  tenantId: string | null;
  negocio: string | null;
  url: string;
  uso: Uso;
  referencias: Referencia[];
  bytes: number;
  impacto: number;
  prioridadNegocio: number;
}

export type Estado =
  | 'simulado'
  | 'aplicado'
  | 'ya-migrado'
  | 'ya-optimo'
  | 'revision-manual'
  | 'externa'
  | 'error'
  | 'revertido';

export interface EntradaDeRegistro {
  clave: string;
  lote: string;
  modo: 'simular' | 'aplicar' | 'revertir';
  estado: Estado;
  tenantId: string | null;
  negocio: string | null;
  uso: Uso;
  urlAnterior: string;
  urlNueva: string | null;
  claveNueva: string | null;
  variantes: Record<string, string>;
  bytesAntes: number | null;
  bytesDespues: number | null;
  /** Peso estimado de lo que ve el cliente a `anchoReferencia` (antes / después). */
  publicoAntes: number | null;
  publicoDespues: number | null;
  ancho: number | null;
  alto: number | null;
  formatoAntes: string | null;
  formatoDespues: string | null;
  alfa: boolean | null;
  referencias: number;
  referenciasActualizadas: number;
  /** Las referencias tocadas, para revertir exactamente esas. */
  detalle: Array<Pick<Referencia, 'tabla' | 'columna' | 'ruta' | 'id'> & { cambio: number }>;
  motivo: string | null;
  fecha: string;
}

export interface Dependencias {
  descargar(url: string): Promise<Buffer>;
  /** Tamaño del objeto si ya existe en el bucket; null si no. */
  existe(key: string): Promise<number | null>;
  subir(key: string, body: Buffer, contentType: string): Promise<void>;
  urlPublica(key: string): string;
  /** UPDATE condicional: devuelve las filas cambiadas (0 si ya no valía `anterior`). */
  actualizar(ref: Referencia, anterior: string, nueva: string): Promise<number>;
  registrar(e: EntradaDeRegistro): Promise<void>;
  /** Guarda los bytes generados (simulación local: carpeta temporal). */
  guardarLocal?(nombre: string, body: Buffer): Promise<string>;
}

/** Hosts cuyo contenido es NUESTRO (bucket) o del Onboarding: lo demás no se toca. */
export function esMigrable(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'pub-6de3a37544604346a69b9836aed1c6cf.r2.dev') return true;
  if (h === 'cdn.soyclubify.com') return true;
  if (h === '5e5288c7d32815944510f3a01aa82614.r2.cloudflarestorage.com') return true;
  return h === 'ugbqfcogmqkuhhepecfq.supabase.co' && u.pathname.startsWith('/storage/v1/object/public/');
}

/** Una URL ya con forma de la política nueva (hash de 20 hex). */
export function yaMigrada(url: string): boolean {
  return /\/[0-9a-f]{20}\.(webp|png|jpg|gif)$/i.test(url.split(/[?#]/)[0]);
}

/**
 * Cuánto pesa en cada visita: los fondos, banners y logos se bajan en TODAS;
 * una foto de producto solo si se llega a ver. Es solo para el orden.
 */
const PESO_DE_USO: Partial<Record<Uso, number>> = {
  BANNER: 10,
  FONDO: 10,
  LOGO: 8,
  SELLO: 8,
  ICONO: 6,
  PORTADA: 5,
  AVISO_EMERGENTE: 5,
  PAGINA_LIBRO: 4,
  INFOLINK: 4,
  PROMOCION: 3,
  PRODUCTO: 1,
};

/**
 * Agrupa referencias en recursos: UNO por negocio + URL. La misma URL usada
 * por dos negocios (pasa con fotos copiadas por el duplicador) son dos
 * recursos: cada negocio recibe su derivado bajo su carpeta y una falla en uno
 * no toca al otro.
 */
export function agrupar(refs: Referencia[]): Recurso[] {
  const m = new Map<string, Recurso>();
  for (const r of refs) {
    const dueño = r.tenantId ?? `slug:${r.negocio ?? '?'}`;
    const clave = `${dueño}|${r.url}`;
    let rec = m.get(clave);
    if (!rec) {
      rec = {
        clave,
        tenantId: r.tenantId,
        negocio: r.negocio,
        url: r.url,
        uso: r.uso,
        referencias: [],
        bytes: r.bytes ?? 0,
        impacto: 0,
        prioridadNegocio: r.prioridadNegocio,
      };
      m.set(clave, rec);
    }
    rec.referencias.push(r);
    rec.bytes = Math.max(rec.bytes, r.bytes ?? 0);
    rec.prioridadNegocio = Math.min(rec.prioridadNegocio, r.prioridadNegocio);
    // Si la misma imagen sirve a dos usos, manda el más exigente (el de
    // maestro más grande): un logo usado también como portada no se encoge.
    rec.uso = masExigente(rec.uso, r.uso);
  }
  for (const rec of m.values()) {
    rec.impacto = rec.bytes * (PESO_DE_USO[rec.uso] ?? 1) * rec.referencias.length;
  }
  return [...m.values()].sort(
    (a, b) => a.prioridadNegocio - b.prioridadNegocio || b.impacto - a.impacto,
  );
}

function masExigente(a: Uso, b: Uso): Uso {
  const la = (POLITICA[a] as PoliticaDeImagen).ladoMaestro ?? 0;
  const lb = (POLITICA[b] as PoliticaDeImagen).ladoMaestro ?? 0;
  return lb > la ? b : a;
}

/** Carpeta del derivado: la del original si se reconoce, si no la del uso. */
function carpetaDe(url: string, uso: Uso, tenantId: string | null): string {
  try {
    const partes = new URL(url).pathname.split('/').filter(Boolean);
    // …/<tenantId>/<carpeta>/<archivo> en nuestro bucket.
    if (tenantId) {
      const i = partes.indexOf(tenantId);
      if (i >= 0 && partes.length - i >= 3) return partes.slice(i + 1, -1).join('/');
    }
  } catch {
    /* URL rara: carpeta del uso */
  }
  return CARPETA_POR_USO[uso];
}

/** Lo que bajaría el cliente a `anchoReferencia` (aprox. del optimizador de Vercel). */
async function pesoPublico(buf: Buffer, p: PoliticaDeImagen): Promise<number | null> {
  try {
    const out = await sharp(buf, { limitInputPixels: p.maxMegapixeles * 1e6, failOn: 'none' })
      .rotate()
      .resize({ width: p.anchoReferencia, withoutEnlargement: true })
      .webp({ quality: Math.min(p.calidad, 80) })
      .toBuffer();
    return out.length;
  } catch {
    return null;
  }
}

function entradaBase(rec: Recurso, lote: string, modo: EntradaDeRegistro['modo']): EntradaDeRegistro {
  return {
    clave: rec.clave,
    lote,
    modo,
    estado: 'error',
    tenantId: rec.tenantId,
    negocio: rec.negocio,
    uso: rec.uso,
    urlAnterior: rec.url,
    urlNueva: null,
    claveNueva: null,
    variantes: {},
    bytesAntes: null,
    bytesDespues: null,
    publicoAntes: null,
    publicoDespues: null,
    ancho: null,
    alto: null,
    formatoAntes: null,
    formatoDespues: null,
    alfa: null,
    referencias: rec.referencias.length,
    referenciasActualizadas: 0,
    detalle: [],
    motivo: null,
    fecha: new Date().toISOString(),
  };
}

/** Cache por hash del ORIGINAL dentro de un negocio: la misma foto subida 17 veces se procesa una. */
type Cache = Map<string, Awaited<ReturnType<typeof procesarImagen>>>;

export async function migrarRecurso(
  rec: Recurso,
  deps: Dependencias,
  opts: { modo: 'simular' | 'aplicar'; lote: string; cache?: Cache },
): Promise<EntradaDeRegistro> {
  const e = entradaBase(rec, opts.lote, opts.modo);
  const politica = POLITICA[rec.uso] as PoliticaDeImagen;
  try {
    if (politica.tipo !== 'imagen') {
      return { ...e, estado: 'revision-manual', motivo: `uso ${rec.uso} no es de imagen` };
    }
    if (yaMigrada(rec.url)) return { ...e, estado: 'ya-migrado' };
    if (!esMigrable(rec.url)) return { ...e, estado: 'externa', motivo: 'host fuera de nuestro bucket' };
    if (opts.modo === 'aplicar' && (!rec.tenantId || rec.referencias.some((r) => !r.tabla || !r.id))) {
      return { ...e, estado: 'error', motivo: 'sin tenantId/tabla/id: solo se puede simular' };
    }

    const original = await deps.descargar(rec.url);
    e.bytesAntes = original.length;
    const formato = detectarFormato(original);
    e.formatoAntes = formato;
    if (!['jpeg', 'png', 'webp', 'gif', 'avif'].includes(formato)) {
      // El caso real: el banner de descomunal es un PDF de 36,5 MB llamado
      // .jpg. No hay imagen que derivar: lo tiene que cambiar una persona.
      return {
        ...e,
        estado: 'revision-manual',
        motivo:
          formato === 'pdf'
            ? 'es un PDF guardado como imagen: hay que subir una imagen de verdad'
            : `no es una imagen (${formato})`,
      };
    }

    const huella = `${rec.tenantId ?? rec.negocio}|${rec.uso}|${createHash('sha256').update(original).digest('hex')}`;
    let r = opts.cache?.get(huella);
    if (!r) {
      // Sin tope de peso del ORIGINAL: aquí no se le niega nada a nadie, se
      // optimiza lo que ya está publicado (aunque hoy no se pudiera subir).
      r = await procesarImagen(original, { ...politica, maxBytesOriginal: Number.MAX_SAFE_INTEGER });
      opts.cache?.set(huella, r);
    }
    e.bytesDespues = r.maestro.buffer.length;
    e.ancho = r.maestro.ancho;
    e.alto = r.maestro.alto;
    e.formatoDespues = r.maestro.contentType;
    e.alfa = r.maestro.tieneAlfa;
    e.publicoAntes = rec.referencias.find((x) => x.pesoServidoHoy != null)?.pesoServidoHoy ?? null;
    e.publicoDespues = await pesoPublico(r.maestro.buffer, politica);

    // Ya óptimo: el maestro no ahorra ni un 10 % y el uso no necesita
    // miniaturas guardadas. Cambiar la URL para nada solo invalida cachés.
    if (r.variantes.length === 0 && r.maestro.buffer.length >= original.length * 0.9) {
      return { ...e, estado: 'ya-optimo', motivo: 'el derivado no ahorra peso' };
    }

    const dueño = rec.tenantId ?? `simulado-${rec.negocio ?? 'sin-negocio'}`;
    const key = `${dueño}/${carpetaDe(rec.url, rec.uso, rec.tenantId)}/${r.maestro.hash}.${r.maestro.ext}`;
    e.claveNueva = key;
    e.urlNueva = deps.urlPublica(key);

    if (opts.modo === 'simular') {
      if (deps.guardarLocal) {
        const base = key.replace(/[\\/]/g, '__');
        e.urlNueva = await deps.guardarLocal(base, r.maestro.buffer);
        for (const v of r.variantes) {
          e.variantes[String(v.ancho)] = await deps.guardarLocal(claveDeVariante(base, v.ancho), v.buffer);
        }
      }
      return { ...e, estado: 'simulado' };
    }

    // APLICAR: primero los objetos (variantes y maestro), luego la base.
    for (const v of r.variantes) {
      const kv = claveDeVariante(key, v.ancho);
      if ((await deps.existe(kv)) !== v.buffer.length) await deps.subir(kv, v.buffer, v.contentType);
      e.variantes[String(v.ancho)] = deps.urlPublica(kv);
    }
    if ((await deps.existe(key)) !== r.maestro.buffer.length) {
      await deps.subir(key, r.maestro.buffer, r.maestro.contentType);
    }
    // Comprobación de lo publicado antes de apuntar nada a ello.
    const subido = await deps.descargar(e.urlNueva);
    if (subido.length !== r.maestro.buffer.length || detectarFormato(subido) === 'desconocido') {
      return { ...e, estado: 'error', motivo: 'el derivado subido no coincide con el generado' };
    }

    for (const ref of rec.referencias) {
      const cambio = await deps.actualizar(ref, rec.url, e.urlNueva);
      e.detalle.push({ tabla: ref.tabla, columna: ref.columna, ruta: ref.ruta, id: ref.id, cambio });
      e.referenciasActualizadas += cambio;
    }
    return {
      ...e,
      estado: 'aplicado',
      motivo:
        e.referenciasActualizadas < rec.referencias.length
          ? `${rec.referencias.length - e.referenciasActualizadas} referencia(s) ya no tenían esta URL (cambiadas mientras tanto): no se tocaron`
          : null,
    };
  } catch (err: any) {
    return {
      ...e,
      estado: err instanceof ArchivoRechazado ? 'revision-manual' : 'error',
      motivo: String(err?.message ?? err).slice(0, 300),
    };
  }
}

/**
 * Revierte entradas `aplicado`: devuelve la URL vieja SOLO donde todavía está
 * la nueva (si el negocio ya subió otra imagen, se respeta). No borra objetos:
 * el derivado queda en el bucket, sin referencias.
 */
export async function revertirEntrada(
  e: EntradaDeRegistro,
  deps: Pick<Dependencias, 'actualizar' | 'registrar'>,
  lote: string,
): Promise<EntradaDeRegistro> {
  const salida: EntradaDeRegistro = {
    ...e,
    lote,
    modo: 'revertir',
    detalle: [],
    referenciasActualizadas: 0,
    fecha: new Date().toISOString(),
  };
  if (e.estado !== 'aplicado' || !e.urlNueva) return { ...salida, estado: e.estado, motivo: 'nada que revertir' };
  for (const d of e.detalle) {
    if (!d.cambio) continue;
    const ref: Referencia = {
      tenantId: e.tenantId,
      negocio: e.negocio,
      tabla: d.tabla,
      columna: d.columna,
      ruta: d.ruta,
      id: d.id,
      uso: e.uso,
      url: e.urlNueva,
      prioridadNegocio: 0,
    };
    const cambio = await deps.actualizar(ref, e.urlNueva, e.urlAnterior);
    salida.detalle.push({ ...d, cambio });
    salida.referenciasActualizadas += cambio;
  }
  return { ...salida, estado: 'revertido' };
}

/** Recorre recursos con concurrencia limitada; nunca lanza (cada fallo queda anotado). */
export async function ejecutar(
  recursos: Recurso[],
  deps: Dependencias,
  opts: {
    modo: 'simular' | 'aplicar';
    lote: string;
    concurrencia?: number;
    /** Claves ya terminadas (reanudación). */
    hechas?: Set<string>;
    alTerminar?: (e: EntradaDeRegistro, i: number, total: number) => void;
  },
): Promise<EntradaDeRegistro[]> {
  const pendientes = recursos.filter((r) => !opts.hechas?.has(r.clave));
  const salida: EntradaDeRegistro[] = [];
  const cache: Cache = new Map();
  let i = 0;
  const trabajador = async () => {
    for (;;) {
      const n = i++;
      if (n >= pendientes.length) return;
      const e = await migrarRecurso(pendientes[n], deps, { modo: opts.modo, lote: opts.lote, cache });
      await deps.registrar(e);
      salida.push(e);
      opts.alTerminar?.(e, salida.length, pendientes.length);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(opts.concurrencia ?? 3, pendientes.length)) }, trabajador),
  );
  return salida;
}

/** Estados que cuentan como terminados para reanudar (los errores se reintentan). */
export const ESTADOS_FINALES: ReadonlySet<Estado> = new Set<Estado>([
  'aplicado',
  'ya-migrado',
  'ya-optimo',
  'revision-manual',
  'externa',
  'simulado',
]);

/**
 * Columnas de la base que la migración sabe actualizar, con su uso. Lo que no
 * está aquí NO se toca. Fuera a propósito: Wallet (Google lee la URL por
 * `sourceUri` y cambiarla exige volver a publicar la clase), los botones del
 * InfoLink (JSON en lista) y el cartel QR (data URL en su config).
 */
export const COLUMNAS: ReadonlyArray<{
  tabla: string;
  columna: string;
  ruta?: string;
  uso: Uso;
  /** SQL que devuelve id, tenantId y url para esta columna. */
  sql: string;
}> = [
  { tabla: 'Tenant', columna: 'logoUrl', uso: 'LOGO', sql: `SELECT id, id AS "tenantId", "logoUrl" AS url FROM "Tenant" WHERE "logoUrl" IS NOT NULL` },
  { tabla: 'Storefront', columna: 'heroImageUrl', uso: 'BANNER', sql: `SELECT id, "tenantId", "heroImageUrl" AS url FROM "Storefront" WHERE "heroImageUrl" IS NOT NULL` },
  { tabla: 'Storefront', columna: 'pageBackgroundImageUrl', uso: 'FONDO', sql: `SELECT id, "tenantId", "pageBackgroundImageUrl" AS url FROM "Storefront" WHERE "pageBackgroundImageUrl" IS NOT NULL` },
  { tabla: 'Storefront', columna: 'popupImageUrl', uso: 'AVISO_EMERGENTE', sql: `SELECT id, "tenantId", "popupImageUrl" AS url FROM "Storefront" WHERE "popupImageUrl" IS NOT NULL` },
  { tabla: 'Storefront', columna: 'bookPopupImageUrl', uso: 'AVISO_EMERGENTE', sql: `SELECT id, "tenantId", "bookPopupImageUrl" AS url FROM "Storefront" WHERE "bookPopupImageUrl" IS NOT NULL` },
  { tabla: 'Storefront', columna: 'recommendedCoverConfig', ruta: 'bgImageUrl', uso: 'PORTADA', sql: `SELECT id, "tenantId", "recommendedCoverConfig"->>'bgImageUrl' AS url FROM "Storefront" WHERE "recommendedCoverConfig"->>'bgImageUrl' IS NOT NULL` },
  { tabla: 'Category', columna: 'imageUrl', uso: 'PORTADA', sql: `SELECT id, "tenantId", "imageUrl" AS url FROM "Category" WHERE "imageUrl" IS NOT NULL` },
  { tabla: 'Category', columna: 'coverConfig', ruta: 'bgImageUrl', uso: 'PORTADA', sql: `SELECT id, "tenantId", "coverConfig"->>'bgImageUrl' AS url FROM "Category" WHERE "coverConfig"->>'bgImageUrl' IS NOT NULL` },
  { tabla: 'Category', columna: 'popupConfig', ruta: 'imageUrl', uso: 'AVISO_EMERGENTE', sql: `SELECT id, "tenantId", "popupConfig"->>'imageUrl' AS url FROM "Category" WHERE "popupConfig"->>'imageUrl' IS NOT NULL` },
  { tabla: 'Product', columna: 'imageUrl', uso: 'PRODUCTO', sql: `SELECT id, "tenantId", "imageUrl" AS url FROM "Product" WHERE "imageUrl" IS NOT NULL` },
  { tabla: 'ProductLocation', columna: 'imageUrl', uso: 'PRODUCTO', sql: `SELECT pl.id, p."tenantId", pl."imageUrl" AS url FROM "ProductLocation" pl JOIN "Product" p ON p.id = pl."productId" WHERE pl."imageUrl" IS NOT NULL` },
  { tabla: 'MenuBookPage', columna: 'imageUrl', uso: 'PAGINA_LIBRO', sql: `SELECT pg.id, s."tenantId", pg."imageUrl" AS url FROM "MenuBookPage" pg JOIN "MenuBookSection" s ON s.id = pg."sectionId"` },
  { tabla: 'MenuBookPage', columna: 'popupImageUrl', uso: 'AVISO_EMERGENTE', sql: `SELECT pg.id, s."tenantId", pg."popupImageUrl" AS url FROM "MenuBookPage" pg JOIN "MenuBookSection" s ON s.id = pg."sectionId" WHERE pg."popupImageUrl" IS NOT NULL` },
  { tabla: 'MenuBookSection', columna: 'popupImageUrl', uso: 'AVISO_EMERGENTE', sql: `SELECT id, "tenantId", "popupImageUrl" AS url FROM "MenuBookSection" WHERE "popupImageUrl" IS NOT NULL` },
  { tabla: 'Promotion', columna: 'imageUrl', uso: 'PROMOCION', sql: `SELECT id, "tenantId", "imageUrl" AS url FROM "Promotion" WHERE "imageUrl" IS NOT NULL` },
  { tabla: 'InfoLink', columna: 'heroImageUrl', uso: 'INFOLINK', sql: `SELECT id, "tenantId", "heroImageUrl" AS url FROM "InfoLink" WHERE "heroImageUrl" IS NOT NULL` },
  { tabla: 'ReservationEvent', columna: 'coverImageUrl', uso: 'PORTADA', sql: `SELECT id, "tenantId", "coverImageUrl" AS url FROM "ReservationEvent" WHERE "coverImageUrl" IS NOT NULL` },
];

/**
 * El UPDATE condicional de una referencia. Identificadores de la lista
 * `COLUMNAS` (nunca del registro a ciegas), valores parametrizados.
 */
export function sqlDeActualizacion(
  ref: Pick<Referencia, 'tabla' | 'columna' | 'ruta'>,
): string | null {
  const c = COLUMNAS.find(
    (x) => x.tabla === ref.tabla && x.columna === ref.columna && (x.ruta ?? null) === (ref.ruta ?? null),
  );
  if (!c) return null;
  const t = `"${c.tabla}"`;
  const col = `"${c.columna}"`;
  if (c.ruta) {
    return (
      `UPDATE ${t} SET ${col} = jsonb_set(${col}::jsonb, '{${c.ruta}}', to_jsonb($2::text)) ` +
      `WHERE id = $1 AND ${col}->>'${c.ruta}' = $3`
    );
  }
  return `UPDATE ${t} SET ${col} = $2 WHERE id = $1 AND ${col} = $3`;
}

/**
 * Uso de la política para una fila del inventario público
 * (`clubify-inventario/recursos.jsonl`). `null` = no se migra (la miniatura
 * del libro es la misma URL que la página; los sellos de marca son de la
 * plataforma, no del negocio).
 */
export function usoDelInventario(u: string): Uso | null {
  switch (u) {
    case 'LOGO':
    case 'LOGO_MARCA':
    case 'INFOLINK_LOGO':
      return 'LOGO';
    case 'ICONO':
    case 'SELLO_MARCA':
      return 'ICONO';
    case 'AVISO_POPUP':
    case 'POPUP_CATEGORIA':
    case 'POPUP_LIBRO':
    case 'INFOLINK_POPUP':
      return 'AVISO_EMERGENTE';
    case 'BANNER':
      return 'BANNER';
    case 'FONDO_PAGINA':
    case 'INFOLINK_FONDO':
      return 'FONDO';
    case 'PROMOCION':
      return 'PROMOCION';
    case 'PRODUCTO':
      return 'PRODUCTO';
    case 'PORTADA_SECCION':
      return 'PORTADA';
    case 'INFOLINK_PORTADA':
    case 'INFOLINK_BOTON':
      return 'INFOLINK';
    case 'PAGINA_LIBRO':
      return 'PAGINA_LIBRO';
    default:
      return null;
  }
}
