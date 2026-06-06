import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SupportMaterialsService } from './support-materials.service';
import { MediaService } from '../media/media.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('admin/support-materials')
@Roles('SUPER_ADMIN', 'MARKETING')
export class SupportMaterialsAdminController {
  constructor(
    private svc: SupportMaterialsService,
    private media: MediaService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.listAll(user);
  }

  @Get('categories')
  categories(@CurrentUser() user: AuthUser) {
    return this.svc.listCategories(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getById(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.create(user, body);
  }

  @Patch('reorder')
  reorder(
    @CurrentUser() user: AuthUser,
    @Body() body: { items: Array<{ id: string; order: number }> },
  ) {
    return this.svc.reorder(user, body?.items ?? []);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }

  /**
   * Upload de archivo para un material. El frontend sube primero, recibe
   * la URL y después la incluye en el POST/PATCH de SupportMaterial. Esto
   * permite cambiar el archivo sin re-crear el row.
   *
   * folder='support-materials' en R2. Tope 25MB (uploadRaw default).
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File) {
    const r = await this.media.uploadRaw({
      folder: 'support-materials',
      fileName: file.originalname,
      buffer: file.buffer,
      contentType: file.mimetype,
    });
    return { url: r.url, size: r.size, contentType: file.mimetype };
  }
}

/** Endpoint scoped al afiliado autenticado — solo ve lo que le toca. */
@Controller('affiliate/support-materials')
@Roles('AFFILIATE_INFLUENCER', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_VENDOR', 'AFFILIATE_SOCIO')
export class SupportMaterialsAffiliateController {
  constructor(private svc: SupportMaterialsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.listForAffiliate(user);
  }
}
