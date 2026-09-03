import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../common/prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { MktTemplateService } from './mkt-template.service';
import { MktTemplateFoldersService } from './mkt-template-folders.service';
import { MktTemplateSendService } from './mkt-template-send.service';

class CreateTemplateDto {
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() @IsString() folderId?: string;
  // `blocks` es el documento del editor ({ version, settings, rows } — ver
  // frontend/src/lib/email-blocks.ts). Sin @IsArray/@IsObject a propósito:
  // guardados viejos traen `[]` y los nuevos un objeto; el tamaño y el veto a
  // `data:image` se validan en el servicio, la única puerta de guardado.
  @IsOptional() blocks?: unknown;
  @IsOptional() @IsString() html?: string;
}
class UpdateTemplateDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() folderId?: string | null;
  @IsOptional() blocks?: unknown;
  @IsOptional() @IsString() html?: string;
  @IsOptional() @IsString() @MaxLength(1000) thumbnailUrl?: string;
}
class SendTemplateDto {
  @IsString() @MaxLength(300) subject!: string;
  @IsArray() @IsString({ each: true }) contactIds!: string[];
}
class CreateFolderDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() parentId?: string;
}
class RenameFolderDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
}
class MoveFolderDto {
  @IsOptional() parentId?: string | null;
}

/**
 * Pestaña Plantillas del Email Marketing: galería de plantillas del editor
 * visual por bloques, en carpetas anidadas, con envío puntual a contactos
 * seleccionados. Brand-scoped por whiteLabelId (mismo patrón que el resto de
 * `admin/marketing`). Las de fábrica (isPreset) son de solo lectura.
 */
@Controller('admin/marketing')
@Roles('PLATFORM_OWNER', 'SUPER_ADMIN')
export class MktTemplatesController {
  constructor(
    private prisma: PrismaService,
    private templates: MktTemplateService,
    private folders: MktTemplateFoldersService,
    private sender: MktTemplateSendService,
  ) {}

  private async brandId(user: AuthUser): Promise<string> {
    if (user.whiteLabelId) return user.whiteLabelId;
    const clubify = await this.prisma.whiteLabel.findUnique({
      where: { slug: 'clubify' },
      select: { id: true },
    });
    if (!clubify) throw new NotFoundException('Marca no resuelta');
    return clubify.id;
  }

  // ── Plantillas ──
  @Get('templates')
  async list(
    @Query('folderId') folderId: string | undefined,
    @Query('q') q: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.templates.list(await this.brandId(user), { folderId, q });
  }

  @Post('templates')
  async create(@Body() body: CreateTemplateDto, @CurrentUser() user: AuthUser) {
    return this.templates.create(await this.brandId(user), body, user.id);
  }

  @Get('templates/:id')
  async getOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.templates.getOne(await this.brandId(user), id);
  }

  @Patch('templates/:id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateTemplateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.templates.update(await this.brandId(user), id, body);
  }

  @Post('templates/:id/duplicate')
  async duplicate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.templates.duplicate(await this.brandId(user), id, user.id);
  }

  @Delete('templates/:id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.templates.remove(await this.brandId(user), id);
  }

  /** Envío puntual a contactos seleccionados. Tope por llamada; ver servicio. */
  @Post('templates/:id/send')
  async send(
    @Param('id') id: string,
    @Body() body: SendTemplateDto,
    @CurrentUser() user: AuthUser,
  ) {
    const whiteLabelId = await this.brandId(user);
    return this.sender.sendToContacts(whiteLabelId, id, body.subject, body.contactIds ?? []);
  }

  // ── Carpetas ──
  @Post('template-folders')
  async createFolder(@Body() body: CreateFolderDto, @CurrentUser() user: AuthUser) {
    return this.folders.create(await this.brandId(user), body.name, body.parentId ?? null);
  }

  @Patch('template-folders/:id')
  async renameFolder(
    @Param('id') id: string,
    @Body() body: RenameFolderDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (body.name === undefined) return { ok: true };
    return this.folders.rename(await this.brandId(user), id, body.name);
  }

  @Patch('template-folders/:id/move')
  async moveFolder(
    @Param('id') id: string,
    @Body() body: MoveFolderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.folders.move(await this.brandId(user), id, body.parentId ?? null);
  }

  @Delete('template-folders/:id')
  async removeFolder(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.folders.remove(await this.brandId(user), id);
  }
}
