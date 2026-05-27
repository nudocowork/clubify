import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { nanoid } from 'nanoid';
import sharp from 'sharp';

const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_AUDIO = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/ogg',
  'audio/webm',
];
const ALLOWED_VIDEO = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
];
const ALLOWED_DOCUMENT = [
  'application/pdf',
];
const MAX_SIZE = 15 * 1024 * 1024; // 15 MB default — sharp pipeline reencode/resize a 2560px+webp
// Folders que aceptan archivos más grandes (menús-imagen de alta resolución
// vienen del diseñador en PDF→PNG y suelen pesar >15 MB sin optimizar).
// Backend igual los reduce a OPT_MAX_DIMENSION=2560 y WebP 90q antes de
// subir al bucket, así el archivo final servido es liviano.
const MAX_SIZE_LARGE = 25 * 1024 * 1024;
const MAX_SIZE_AUDIO = 50 * 1024 * 1024; // 50 MB — audios largos para secuencias CRM
const MAX_SIZE_VIDEO = 100 * 1024 * 1024; // 100 MB — videos cortos vertical
const MAX_SIZE_DOCUMENT = 30 * 1024 * 1024; // 30 MB — PDFs/catálogos
const LARGE_FOLDERS = new Set(['menu-book', 'menu-book-popup']);

/** Multer limit global tope (cubre el archivo más pesado: video 100MB). */
export const MEDIA_MULTER_LIMIT_BYTES = MAX_SIZE_VIDEO;

type MediaCategory = 'image' | 'audio' | 'video' | 'document';

function categorize(mimetype: string): MediaCategory | null {
  if (ALLOWED_IMAGE.includes(mimetype)) return 'image';
  if (ALLOWED_AUDIO.includes(mimetype)) return 'audio';
  if (ALLOWED_VIDEO.includes(mimetype)) return 'video';
  if (ALLOWED_DOCUMENT.includes(mimetype)) return 'document';
  return null;
}

/**
 * Deriva extensión del archivo para non-images. Preferimos la del originalname
 * sanitizada (preserva m4a/wav/mov etc). Fallback al mimetype default por
 * categoría si el originalname no trae extensión usable.
 */
function extForCategory(
  file: Express.Multer.File,
  category: MediaCategory,
): string {
  const fromName = (file.originalname.split('.').pop() ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
  if (fromName) return fromName;
  if (category === 'audio') {
    if (file.mimetype.includes('wav')) return 'wav';
    if (file.mimetype.includes('m4a') || file.mimetype.includes('mp4'))
      return 'm4a';
    if (file.mimetype.includes('aac')) return 'aac';
    if (file.mimetype.includes('ogg')) return 'ogg';
    if (file.mimetype.includes('webm')) return 'webm';
    return 'mp3';
  }
  if (category === 'video') {
    if (file.mimetype.includes('quicktime')) return 'mov';
    if (file.mimetype.includes('webm')) return 'webm';
    return 'mp4';
  }
  if (category === 'document') return 'pdf';
  return 'bin';
}

// Umbrales de optimización. Imágenes grandes se resize-an a 2560px max y
// se reencodean a webp (excepto GIF que conserva animation y PNG con alpha
// que mantenemos para evitar bordes feos).
//
// 2560×1440 cubre desktop 2K nítido (común en pantallas Retina y monitores
// QHD modernos). Antes era 2000 lo que dejaba slides full-screen con
// upscaling visible en pantallas grandes. WebP 90 (era 85) reduce
// artefactos de doble compresión cuando el frontend ya pre-comprime el
// crop a JPEG 95.
const OPT_MAX_DIMENSION = 2560;
const OPT_SIZE_TRIGGER = 1024 * 1024; // 1 MB
const OPT_WEBP_QUALITY = 90;

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

  async upload(opts: {
    tenantId?: string;
    folder?: string;
    file: Express.Multer.File;
  }): Promise<{
    url: string;
    key: string;
    size: number;
    contentType: string;
    category: MediaCategory;
  }> {
    if (!opts.file) throw new BadRequestException('No file provided');
    const folder = opts.folder ?? 'products';

    const category = categorize(opts.file.mimetype);
    if (!category) {
      throw new BadRequestException(`Tipo no permitido: ${opts.file.mimetype}`);
    }

    const maxSize =
      category === 'audio'
        ? MAX_SIZE_AUDIO
        : category === 'video'
          ? MAX_SIZE_VIDEO
          : category === 'document'
            ? MAX_SIZE_DOCUMENT
            : LARGE_FOLDERS.has(folder)
              ? MAX_SIZE_LARGE
              : MAX_SIZE;
    if (opts.file.size > maxSize) {
      throw new BadRequestException(
        `Archivo muy grande (max ${maxSize / 1024 / 1024}MB)`,
      );
    }
    if (!this.configured && process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException(
        'Storage no configurado. Contacta al administrador.',
      );
    }

    const tenantPart = opts.tenantId ? `${opts.tenantId}/` : '';

    // Para imágenes: pipeline sharp con resize/re-encode. Para audio/video/PDF:
    // upload directo sin tocar (sharp no aplica y comprimirlos de otra forma
    // requiere ffmpeg/qpdf que no tenemos en el container).
    let bodyBuffer: Buffer;
    let outContentType: string;
    let outExt: string;

    if (category === 'image') {
      const optimized = await this.maybeOptimize(opts.file);
      bodyBuffer = optimized.buffer;
      outContentType = optimized.contentType;
      outExt = optimized.ext;
    } else {
      bodyBuffer = opts.file.buffer;
      outContentType = opts.file.mimetype;
      outExt = extForCategory(opts.file, category);
    }

    const key = `${tenantPart}${folder}/${nanoid(16)}.${outExt}`;

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bodyBuffer,
          ContentType: outContentType,
          // Imágenes: immutable (nombre incluye hash random, nunca cambia).
          // Non-images: igual immutable porque el key tiene nanoid único.
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (e: any) {
      this.logger.error(`Upload failed: ${e?.name} ${e?.message}`);
      throw new ServiceUnavailableException(
        `Storage error: ${e?.name ?? 'unknown'} — verifica las credenciales R2.`,
      );
    }

    const url = `${this.publicUrl.replace(/\/$/, '')}/${key}`;
    const savings =
      category === 'image' && opts.file.size > bodyBuffer.length
        ? ` -${Math.round((1 - bodyBuffer.length / opts.file.size) * 100)}%`
        : '';
    this.logger.log(
      `Uploaded ${key} (${bodyBuffer.length} bytes,` +
        ` was ${opts.file.size}${savings}, ${outContentType}, cat=${category})`,
    );
    return {
      url,
      key,
      size: bodyBuffer.length,
      contentType: outContentType,
      category,
    };
  }

  /**
   * Upload genérico para archivos NO-imagen (PDFs, DOCX, etc.). Sin
   * validación de MIME por whitelist — el caller decide. Sin optimización.
   * Tope 25MB (vs 5MB de imágenes).
   *
   * Devuelve URL pública del bucket.
   */
  async uploadRaw(opts: {
    folder: string;
    fileName: string;
    buffer: Buffer;
    contentType: string;
  }): Promise<{ url: string; key: string; size: number }> {
    const RAW_MAX = 25 * 1024 * 1024; // 25 MB
    if (opts.buffer.length > RAW_MAX) {
      throw new BadRequestException(
        `Archivo muy grande (max ${RAW_MAX / 1024 / 1024}MB)`,
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

  /**
   * Si el upload es grande, reduce dimensiones a 2000px max y re-encodea
   * a webp. PNG con alpha → mantiene PNG (webp pierde transparency en
   * algunos clients). GIF → no se toca (sharp puede romper animation).
   */
  private async maybeOptimize(file: Express.Multer.File): Promise<{
    buffer: Buffer;
    contentType: string;
    ext: string;
  }> {
    const fallbackExt =
      file.originalname.split('.').pop()?.toLowerCase() ?? 'jpg';
    const fallback = {
      buffer: file.buffer,
      contentType: file.mimetype,
      ext: fallbackExt,
    };

    // GIF: preservar tal cual (anim).
    if (file.mimetype === 'image/gif') return fallback;
    // Pequeñas: no vale la pena el costo CPU.
    if (file.size < OPT_SIZE_TRIGGER) {
      // Pero igual chequeamos dimensiones; alguien podría subir un PNG
      // 4000x4000 que pesa <1MB y rompe layouts del frontend.
    }

    try {
      const pipeline = sharp(file.buffer, { failOn: 'none' });
      const meta = await pipeline.metadata();
      const needsResize =
        (meta.width ?? 0) > OPT_MAX_DIMENSION ||
        (meta.height ?? 0) > OPT_MAX_DIMENSION;
      const needsReencode = file.size >= OPT_SIZE_TRIGGER;

      if (!needsResize && !needsReencode) return fallback;

      let out = pipeline;
      if (needsResize) {
        out = out.resize({
          width: OPT_MAX_DIMENSION,
          height: OPT_MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      // PNG con alpha → mantener PNG con compresión. Sino → webp (mejor ratio).
      const hasAlpha = meta.hasAlpha === true;
      if (file.mimetype === 'image/png' && hasAlpha) {
        const buf = await out.png({ compressionLevel: 9 }).toBuffer();
        return { buffer: buf, contentType: 'image/png', ext: 'png' };
      }
      const buf = await out.webp({ quality: OPT_WEBP_QUALITY }).toBuffer();
      return { buffer: buf, contentType: 'image/webp', ext: 'webp' };
    } catch (e: any) {
      this.logger.warn(
        `sharp optimize failed (${e?.message ?? e}) — subiendo original`,
      );
      return fallback;
    }
  }
}
