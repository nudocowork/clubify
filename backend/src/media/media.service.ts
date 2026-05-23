import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { nanoid } from 'nanoid';
import sharp from 'sharp';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 15 * 1024 * 1024; // 15 MB default — sharp pipeline reencode/resize a 2560px+webp
// Folders que aceptan archivos más grandes (menús-imagen de alta resolución
// vienen del diseñador en PDF→PNG y suelen pesar >15 MB sin optimizar).
// Backend igual los reduce a OPT_MAX_DIMENSION=2560 y WebP 90q antes de
// subir al bucket, así el archivo final servido es liviano.
const MAX_SIZE_LARGE = 25 * 1024 * 1024;
const LARGE_FOLDERS = new Set(['menu-book', 'menu-book-popup']);

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
  }): Promise<{ url: string; key: string; size: number; contentType: string }> {
    if (!opts.file) throw new BadRequestException('No file provided');
    const folder = opts.folder ?? 'products';
    const maxSize = LARGE_FOLDERS.has(folder) ? MAX_SIZE_LARGE : MAX_SIZE;
    if (opts.file.size > maxSize) {
      throw new BadRequestException(`Archivo muy grande (max ${maxSize / 1024 / 1024}MB)`);
    }
    if (!ALLOWED.includes(opts.file.mimetype)) {
      throw new BadRequestException(`Tipo no permitido: ${opts.file.mimetype}`);
    }
    if (!this.configured && process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException(
        'Storage no configurado. Contacta al administrador.',
      );
    }

    const tenantPart = opts.tenantId ? `${opts.tenantId}/` : '';

    // Optimización: resize + re-encode si la imagen es grande. Best-effort —
    // si sharp falla por cualquier razón, subimos el original sin bloquear.
    const optimized = await this.maybeOptimize(opts.file);
    const ext = optimized.ext;
    const key = `${tenantPart}${folder}/${nanoid(16)}.${ext}`;

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: optimized.buffer,
          ContentType: optimized.contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (e: any) {
      this.logger.error(`Upload failed: ${e?.name} ${e?.message}`);
      throw new ServiceUnavailableException(
        `Storage error: ${e?.name ?? 'unknown'} — verifica las credenciales R2.`,
      );
    }

    // URL pública servible al cliente (R2 público o CDN custom)
    const url = `${this.publicUrl.replace(/\/$/, '')}/${key}`;
    const savings =
      opts.file.size > optimized.buffer.length
        ? ` -${Math.round((1 - optimized.buffer.length / opts.file.size) * 100)}%`
        : '';
    this.logger.log(
      `Uploaded ${key} (${optimized.buffer.length} bytes,` +
        ` was ${opts.file.size}${savings}, ${optimized.contentType})`,
    );
    return {
      url,
      key,
      size: optimized.buffer.length,
      contentType: optimized.contentType,
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
