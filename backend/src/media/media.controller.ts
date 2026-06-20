import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
  Query,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaService, MEDIA_MULTER_LIMIT_BYTES } from './media.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

// Afiliados (INFLUENCER/AMBASSADOR/SOCIO) también suben archivos —
// adjuntos de botones del CRM (folder=crm-buttons). MARKETING entra
// para los assets de marketing que gestiona cross-tenant. PLATFORM_OWNER
// sube logo/favicon de las marcas blancas desde /superadmin/marcas.
@Controller('media')
@Roles(
  'PLATFORM_OWNER',
  'TENANT_OWNER',
  'TENANT_STAFF',
  'SUPER_ADMIN',
  'MARKETING',
  'AFFILIATE_INFLUENCER',
  'AFFILIATE_AMBASSADOR',
  'AFFILIATE_SOCIO',
)
export class MediaController {
  constructor(private svc: MediaService) {}

  @Get('config')
  config() {
    return { configured: this.svc.isConfigured() };
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      // Tope global multer = max video 100 MB. La validación fina por
      // categoría (imagen 15/25, audio 50, video 100, pdf 30) corre dentro
      // del service para devolver mensaje claro. Sin este limit explícito
      // multer trunca silencioso archivos grandes.
      limits: { fileSize: MEDIA_MULTER_LIMIT_BYTES },
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') folder?: string,
  ) {
    return this.svc.upload({
      tenantId: user.tenantId ?? undefined,
      folder: folder ?? 'products',
      file,
    });
  }

  /**
   * Proxy CORS para imágenes ya subidas. R2 (público) no devuelve headers
   * Access-Control-Allow-Origin por default → el cropper del frontend no
   * puede leer pixels via canvas para re-editar. Este endpoint hace de
   * intermediario: fetch server-side de la imagen del bucket y la re-sirve
   * con CORS abierto.
   *
   * Validación: solo proxea URLs que empiezan con S3_PUBLIC_URL — evita
   * uso como SSRF abierto.
   */
  @Public()
  @Get('proxy')
  async proxy(@Query('url') url: string, @Res() res: Response) {
    if (!url) throw new BadRequestException('url required');
    // FIX 2026-06-16 (review #3 SSRF): comparar HOST exacto, no prefijo.
    // `startsWith(base)` aceptaba `https://<base>.attacker.com/...`. Además
    // exigimos https y capamos el tamaño de la respuesta (no bufferear
    // upstreams gigantes en memoria) + timeout.
    let parsed: URL;
    let baseHost: string;
    try {
      parsed = new URL(url);
      baseHost = new URL(this.svc.getPublicBase()).host;
    } catch {
      throw new BadRequestException('url inválida');
    }
    if (parsed.protocol !== 'https:' || parsed.host !== baseHost) {
      throw new BadRequestException('Solo URLs de nuestro bucket');
    }
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch(() => {
      throw new BadRequestException('Upstream inalcanzable');
    });
    if (!r.ok) {
      throw new BadRequestException(`Upstream ${r.status}`);
    }
    const MAX_BYTES = 15 * 1024 * 1024; // 15MB
    const len = Number(r.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) {
      throw new BadRequestException('Archivo demasiado grande');
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      throw new BadRequestException('Archivo demasiado grande');
    }
    const contentType = r.headers.get('content-type') ?? 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(buf);
  }
}
