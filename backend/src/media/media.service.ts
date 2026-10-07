import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { categoriaDeFormato, detectarFormato } from './detectar-formato';
import { importarPdf } from './importar-pdf';
import {
  ArchivoRechazado,
  claveDeVariante,
  procesarImagen,
  type ResultadoDeProcesar,
} from './procesar-imagen';
import {
  CARPETA_POR_USO,
  MAX_BYTES_TRANSMISION,
  mensajeDePesoExcedido,
  POLITICA,
  politicaDe,
  resolverUso,
  type PoliticaDeImagen,
  type PoliticaDePdf,
  type Uso,
} from './politica-de-archivos';
import { nanoid } from 'nanoid';

/**
 * Límite de multer: el mayor tope de transmisión de la política (video de
 * adjunto, 100 MB). La validación fina por USO corre en el servicio para
 * devolver el motivo en español. Sin un `limits` explícito multer trunca en
 * silencio los archivos grandes.
 */
export const MEDIA_MULTER_LIMIT_BYTES = MAX_BYTES_TRANSMISION;

type MediaCategory = 'image' | 'audio' | 'video' | 'document';

/**
 * Procesamientos de imagen simultáneos por instancia. Decodificar una foto de
 * 50 MP son ~200 MB de RAM; sin tope, una carta de 30 páginas subida de a 3 por
 * dos negocios a la vez se come la memoria del contenedor.
 */
const PROCESOS_DE_IMAGEN_SIMULTANEOS = 2;

export interface ResultadoDeSubida {
  url: string;
  key: string;
  size: number;
  contentType: string;
  category: MediaCategory;
  uso: Uso;
  ancho?: number;
  alto?: number;
  bytesOriginal: number;
  /** Variantes guardadas en el bucket, por ancho («160» → URL). */
  variantes: Record<string, string>;
}

function extDeAdjunto(file: Express.Multer.File, category: MediaCategory): string {
  const partes = (file.originalname ?? '').split('.');
  const fromName =
    partes.length > 1
      ? (partes.pop() ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 8)
      : '';
  if (fromName) return fromName;
  if (category === 'audio') return 'mp3';
  if (category === 'video') return 'mp4';
  if (category === 'document') return 'pdf';
  return 'bin';
}

/** `?folder=` va dentro de la clave del bucket: nada de `..` ni rutas absolutas. */
function carpetaSegura(folder: string): string {
  const f = folder.trim();
  if (!/^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*){0,3}$/i.test(f)) {
    throw new BadRequestException('Carpeta de destino inválida.');
  }
  return f;
}

/**
 * Provee storage S3-compatible (Cloudflare R2 en prod, MinIO en dev).
 *
 * Env vars necesarias en producción:
 *   S3_ENDPOINT     → https://<account>.r2.cloudflarestorage.com
 *   S3_BUCKET       → nombre del bucket (ej: clubify-media)
 *   S3_ACCESS_KEY   → R2 access key
 *   S3_SECRET_KEY   → R2 secret key
 *   S3_REGION       → "auto" para R2
 *   S3_PUBLIC_URL   → URL pública base donde se sirven los archivos
 *                     (ej: https://pub-xxx.r2.dev  o  https://cdn.soyclubify.com)
 *   S3_FORCE_PATH_STYLE → "true" para R2/MinIO (default true)
 */
@Injectable()
export class MediaService {
  private logger = new Logger(MediaService.name);
  private s3: S3Client;
  private bucket: string;
  private endpoint: string;
  private publicUrl: string;
  private configured: boolean;

  constructor() {
    this.endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
    this.bucket = process.env.S3_BUCKET ?? 'clubify-media';
    // En dev MinIO sirve por el mismo endpoint. En prod (R2) el público es otro.
    this.publicUrl =
      process.env.S3_PUBLIC_URL ?? `${this.endpoint}/${this.bucket}`;
    this.configured =
      !!process.env.S3_ENDPOINT &&
      !!process.env.S3_ACCESS_KEY &&
      !!process.env.S3_SECRET_KEY;

    this.s3 = new S3Client({
      endpoint: this.endpoint,
      region: process.env.S3_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? 'minio',
        secretAccessKey: process.env.S3_SECRET_KEY ?? 'minio12345',
      },
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    });

    if (!this.configured && process.env.NODE_ENV === 'production') {
      this.logger.warn(
        '⚠ Storage NO configurado en prod. Setea S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY.',
      );
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  /** Base pública del bucket — usado por el proxy para validar URLs. */
  getPublicBase(): string {
    return this.publicUrl.replace(/\/$/, '');
  }

  /**
   * Sube UN archivo según la política de su USO (`politica-de-archivos.ts`).
   *
   * Todo o nada: si el archivo no pasa (peso, formato real, decodificación,
   * dimensiones) o no se puede procesar, se responde el motivo en español y no
   * se publica NADA. Ya no existe el «subiendo original» de antes.
   *
   * `uso` manda; si no viene, se deduce de `folder` (los clientes de siempre),
   * así que todo entra bajo la política aunque el frontend sea el viejo.
   */
  async upload(opts: {
    tenantId?: string;
    folder?: string;
    uso?: string;
    file: Express.Multer.File;
  }): Promise<ResultadoDeSubida> {
    if (!opts.file?.buffer) throw new BadRequestException('No llegó ningún archivo.');
    const uso = resolverUso({ uso: opts.uso, folder: opts.folder });
    if (!uso) throw new BadRequestException(`Uso de archivo desconocido: «${opts.uso}».`);
    const politica = politicaDe(uso);
    if (politica.tipo === 'pdf') {
      throw new BadRequestException('Los PDF del menú se importan con «Importar PDF», no como imagen.');
    }
    const folder = carpetaSegura(opts.folder ?? CARPETA_POR_USO[uso]);
    this.exigirAlmacenamiento();
    const base = `${opts.tenantId ? `${opts.tenantId}/` : ''}${folder}/`;

    if (politica.tipo === 'imagen') {
      const r = await this.procesar(opts.file.buffer, politica);
      return this.publicarImagen(base, uso, r);
    }

    // ADJUNTO: imagen (con las reglas de GENERAL, pero el tope del adjunto),
    // PDF, audio o video. El tipo se decide por el CONTENIDO.
    const formato = detectarFormato(opts.file.buffer);
    const categoria = categoriaDeFormato(formato);
    const declarada = categoriaDeclarada(opts.file.mimetype);
    if (!categoria || !compatibles(categoria, declarada)) {
      throw new BadRequestException(
        formato === 'heic'
          ? 'Esta foto está en formato HEIC (el de los iPhone). Expórtala como JPG y vuelve a subirla.'
          : 'El archivo no es una imagen, PDF, audio o video válido (su contenido no coincide con su extensión).',
      );
    }
    // Un .m4a se detecta como contenedor MP4: si lo declararon audio, es audio.
    const cat: MediaCategory = categoria === 'video' && declarada === 'audio' ? 'audio' : categoria;
    if (cat === 'image') {
      const r = await this.procesar(opts.file.buffer, {
        ...(POLITICA.GENERAL as PoliticaDeImagen),
        maxBytesOriginal: politica.maxBytesImagen,
      });
      return this.publicarImagen(base, uso, r);
    }
    const max =
      cat === 'audio'
        ? politica.maxBytesAudio
        : cat === 'video'
          ? politica.maxBytesVideo
          : politica.maxBytesDocumento;
    if (opts.file.buffer.length > max) {
      throw new PayloadTooLargeException(
        mensajeDePesoExcedido({
          bytes: opts.file.buffer.length,
          maximo: max,
          etiqueta: 'adjuntos',
          esImagen: false,
        }),
      );
    }
    // Audio, video y PDF van sin re-codificar: comprimirlos pide ffmpeg/qpdf,
    // que el contenedor no tiene. Al menos ya se sabe que SON lo que dicen.
    const hash = createHash('sha256').update(opts.file.buffer).digest('hex').slice(0, 20);
    const key = `${base}${hash}.${extDeAdjunto(opts.file, cat)}`;
    const contentType =
      cat === 'document'
        ? 'application/pdf'
        : declarada === cat
          ? opts.file.mimetype
          : `${cat}/${formato}`;
    await this.put(key, opts.file.buffer, contentType);
    this.logger.log(`Uploaded ${key} (${opts.file.buffer.length} bytes, ${contentType}, uso=${uso})`);
    return {
      url: this.urlDe(key),
      key,
      size: opts.file.buffer.length,
      contentType,
      category: cat,
      uso,
      bytesOriginal: opts.file.buffer.length,
      variantes: {},
    };
  }

  /**
   * Importa un PDF de menú libro: devuelve UNA página publicada por cada
   * página del PDF (maestro + miniaturas). El PDF no se guarda.
   */
  async importarPdfDelMenu(opts: {
    tenantId?: string;
    file: Express.Multer.File;
  }): Promise<{ total: number; paginas: ResultadoDeSubida[] }> {
    if (!opts.file?.buffer) throw new BadRequestException('No llegó ningún archivo.');
    const politica = POLITICA.PDF_MENU as PoliticaDePdf;
    if (this.importacionesEnCurso >= politica.concurrencia) {
      throw new ServiceUnavailableException(
        'Ya hay otra importación de PDF en curso. Inténtalo de nuevo en un minuto.',
      );
    }
    this.exigirAlmacenamiento();
    this.importacionesEnCurso++;
    try {
      const { paginas, total } = await importarPdf(opts.file.buffer, { politica }).catch((e) => {
        throw aHttp(e);
      });
      const base = `${opts.tenantId ? `${opts.tenantId}/` : ''}${CARPETA_POR_USO.PAGINA_LIBRO}/`;
      const publicadas: ResultadoDeSubida[] = [];
      for (const p of paginas) {
        publicadas.push(await this.publicarImagen(base, 'PAGINA_LIBRO', p.resultado));
      }
      this.logger.log(`PDF importado: ${total} páginas (${opts.file.buffer.length} bytes)`);
      return { total, paginas: publicadas };
    } finally {
      this.importacionesEnCurso--;
    }
  }

  private importacionesEnCurso = 0;
  private procesosDeImagen = 0;
  private colaDeImagen: Array<() => void> = [];

  private async procesar(buffer: Buffer, politica: PoliticaDeImagen): Promise<ResultadoDeProcesar> {
    while (this.procesosDeImagen >= PROCESOS_DE_IMAGEN_SIMULTANEOS) {
      await new Promise<void>((res) => this.colaDeImagen.push(res));
    }
    this.procesosDeImagen++;
    try {
      return await procesarImagen(buffer, politica);
    } catch (e) {
      throw aHttp(e);
    } finally {
      this.procesosDeImagen--;
      this.colaDeImagen.shift()?.();
    }
  }

  /**
   * Sube variantes y después el maestro, con el HASH del maestro como nombre:
   * reemplazar una imagen da otra URL (la caché de un año del optimizador y del
   * navegador no sirve la vieja), y subir dos veces la misma no duplica nada.
   *
   * Si una subida falla no se borra lo ya subido, a propósito: la clave es por
   * contenido y puede ser la de una imagen idéntica que ya usa otro registro.
   * Lo subido queda huérfano pero NO publicado: no se devuelve ninguna URL.
   */
  private async publicarImagen(
    base: string,
    uso: Uso,
    r: ResultadoDeProcesar,
  ): Promise<ResultadoDeSubida> {
    const key = `${base}${r.maestro.hash}.${r.maestro.ext}`;
    const variantes: Record<string, string> = {};
    for (const v of r.variantes) {
      const kv = claveDeVariante(key, v.ancho);
      await this.put(kv, v.buffer, v.contentType);
      variantes[String(v.ancho)] = this.urlDe(kv);
    }
    await this.put(key, r.maestro.buffer, r.maestro.contentType);
    const ahorro =
      r.original.bytes > r.maestro.buffer.length
        ? ` -${Math.round((1 - r.maestro.buffer.length / r.original.bytes) * 100)}%`
        : '';
    this.logger.log(
      `Uploaded ${key} (${r.maestro.buffer.length} bytes, was ${r.original.bytes}${ahorro}, ` +
        `${r.maestro.ancho}x${r.maestro.alto}, uso=${uso}, variantes=${r.variantes.length})`,
    );
    return {
      url: this.urlDe(key),
      key,
      size: r.maestro.buffer.length,
      contentType: r.maestro.contentType,
      category: 'image',
      uso,
      ancho: r.maestro.ancho,
      alto: r.maestro.alto,
      bytesOriginal: r.original.bytes,
      variantes,
    };
  }

  private exigirAlmacenamiento() {
    if (!this.configured && process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('Storage no configurado. Contacta al administrador.');
    }
  }

  private urlDe(key: string): string {
    return `${this.publicUrl.replace(/\/$/, '')}/${key}`;
  }

  private async put(key: string, body: Buffer, contentType: string) {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // La clave lleva el hash del contenido: nunca cambia → immutable.
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (e: any) {
      this.logger.error(`Upload failed: ${e?.name} ${e?.message}`);
      throw new ServiceUnavailableException(
        'No pudimos guardar el archivo en el almacenamiento. No se publicó nada; inténtalo de nuevo.',
      );
    }
  }

  /**
   * Upload genérico para archivos NO-imagen (PDFs, DOCX, etc.). Sin
   * validación de MIME por whitelist — el caller decide. Sin optimización.
   * Solo lo usan pantallas de la PLATAFORMA (materiales de soporte, base de
   * conocimiento de la IA), nunca un negocio: por eso queda fuera de la
   * política por uso. Tope 25 MB decimales, como el resto.
   *
   * Devuelve URL pública del bucket.
   */
  async uploadRaw(opts: {
    folder: string;
    fileName: string;
    buffer: Buffer;
    contentType: string;
  }): Promise<{ url: string; key: string; size: number }> {
    const RAW_MAX = 25_000_000;
    if (opts.buffer.length > RAW_MAX) {
      throw new PayloadTooLargeException(
        mensajeDePesoExcedido({
          bytes: opts.buffer.length,
          maximo: RAW_MAX,
          etiqueta: 'documentos',
          esImagen: false,
        }),
      );
    }
    if (!this.configured && process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('Storage no configurado.');
    }
    // Sanitize filename → derive safe extension + slug.
    const ext = (opts.fileName.split('.').pop() ?? 'bin')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8);
    const key = `${opts.folder}/${nanoid(16)}.${ext || 'bin'}`;
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: opts.buffer,
          ContentType: opts.contentType,
          CacheControl: 'public, max-age=2592000',
        }),
      );
    } catch (e: any) {
      this.logger.error(`Raw upload failed: ${e?.name} ${e?.message}`);
      throw new ServiceUnavailableException(
        `Storage error: ${e?.name ?? 'unknown'}`,
      );
    }
    const url = `${this.publicUrl.replace(/\/$/, '')}/${key}`;
    return { url, key, size: opts.buffer.length };
  }
}

function categoriaDeclarada(mime: string | undefined): MediaCategory | null {
  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (m === 'application/pdf') return 'document';
  return null;
}

/**
 * Lo detectado y lo declarado tienen que casar. Contenedores como MP4/WebM/OGG
 * sirven igual para audio que para video (un .m4a es un MP4), así que ahí se
 * acepta cualquiera de los dos. Sin tipo declarado (`octet-stream`) manda lo
 * detectado.
 */
function compatibles(detectada: MediaCategory, declarada: MediaCategory | null): boolean {
  if (!declarada || detectada === declarada) return true;
  const av = new Set<MediaCategory>(['audio', 'video']);
  return av.has(detectada) && av.has(declarada);
}

function aHttp(e: unknown): unknown {
  if (e instanceof ArchivoRechazado) {
    return e.motivo === 'peso'
      ? new PayloadTooLargeException(e.message)
      : new BadRequestException(e.message);
  }
  return e;
}
