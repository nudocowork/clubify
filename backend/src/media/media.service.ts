import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { nanoid } from 'nanoid';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

@Injectable()
export class MediaService {
  private logger = new Logger(MediaService.name);
  private s3: S3Client;
  private bucket: string;
  private endpoint: string;

  constructor() {
    this.endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
    this.bucket = process.env.S3_BUCKET ?? 'clubify-media';
    this.s3 = new S3Client({
      endpoint: this.endpoint,
      region: process.env.S3_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? 'minio',
        secretAccessKey: process.env.S3_SECRET_KEY ?? 'minio12345',
      },
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    });
  }

  async upload(opts: {
    tenantId?: string;
    folder?: string;
    file: Express.Multer.File;
  }): Promise<{ url: string; key: string; size: number; contentType: string }> {
    if (!opts.file) throw new BadRequestException('No file provided');
    if (opts.file.size > MAX_SIZE) {
      throw new BadRequestException(`Archivo muy grande (max ${MAX_SIZE / 1024 / 1024}MB)`);
    }
    if (!ALLOWED.includes(opts.file.mimetype)) {
      throw new BadRequestException(`Tipo no permitido: ${opts.file.mimetype}`);
    }

    const ext = opts.file.originalname.split('.').pop()?.toLowerCase() ?? 'jpg';
    const folder = opts.folder ?? 'uploads';
    const tenantPart = opts.tenantId ? `${opts.tenantId}/` : '';
    const key = `${tenantPart}${folder}/${nanoid(16)}.${ext}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: opts.file.buffer,
        ContentType: opts.file.mimetype,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    const url = `${this.endpoint}/${this.bucket}/${key}`;
    this.logger.log(`Uploaded ${key} (${opts.file.size} bytes)`);
    return { url, key, size: opts.file.size, contentType: opts.file.mimetype };
  }
}
