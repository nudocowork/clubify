import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { SuperAdminService } from './superadmin.service';

class MessageTemplateBody {
  @IsOptional() @IsString() @MaxLength(2000) text?: string | null;
}
class FolderBody {
  @IsString() @MaxLength(60) name!: string;
}
class MoveBody {
  @IsString() @MaxLength(80) folderId!: string;
}

/**
 * Automatizaciones (mensajes SMS/WhatsApp editables + carpetas) desde el panel
 * de la PROPIA MARCA (`/admin`, AppShell). A diferencia del Master Admin
 * (/superadmin/white-labels/:id/...), acá la marca se resuelve del token del
 * que llama: SUPER_ADMIN de la marca → su `whiteLabelId`; PLATFORM_OWNER (sesión
 * Clubify, sin whiteLabelId) → la marca Clubify. Reusa `SuperAdminService`.
 */
@Controller('admin/automations')
@Roles('PLATFORM_OWNER', 'SUPER_ADMIN')
export class AdminAutomationsController {
  constructor(
    private svc: SuperAdminService,
    private prisma: PrismaService,
  ) {}

  /** Marca del que llama (su whiteLabelId, o Clubify si es PLATFORM_OWNER). */
  private async resolveBrandId(user: AuthUser): Promise<string> {
    if (user.whiteLabelId) return user.whiteLabelId;
    const clubify = await this.prisma.whiteLabel.findUnique({
      where: { slug: 'clubify' },
      select: { id: true },
    });
    if (!clubify) throw new NotFoundException('Marca no resuelta');
    return clubify.id;
  }

  @Get('message-templates')
  async list(@CurrentUser() user: AuthUser) {
    return this.svc.getBrandMessageTemplates(await this.resolveBrandId(user));
  }

  @Patch('message-templates/:templateId')
  async update(
    @Param('templateId') templateId: string,
    @Body() body: MessageTemplateBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.updateBrandMessageTemplate(
      await this.resolveBrandId(user),
      templateId,
      body.text ?? null,
      user.id,
    );
  }

  @Patch('message-templates/:templateId/folder')
  async move(
    @Param('templateId') templateId: string,
    @Body() body: MoveBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.moveAutomationTemplate(
      await this.resolveBrandId(user),
      templateId,
      body.folderId,
      user.id,
    );
  }

  @Post('folders')
  async createFolder(
    @Body() body: FolderBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.createAutomationFolder(
      await this.resolveBrandId(user),
      body.name,
      user.id,
    );
  }

  @Patch('folders/:folderId')
  async renameFolder(
    @Param('folderId') folderId: string,
    @Body() body: FolderBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.renameAutomationFolder(
      await this.resolveBrandId(user),
      folderId,
      body.name,
      user.id,
    );
  }

  @Delete('folders/:folderId')
  async deleteFolder(
    @Param('folderId') folderId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.deleteAutomationFolder(
      await this.resolveBrandId(user),
      folderId,
      user.id,
    );
  }
}
