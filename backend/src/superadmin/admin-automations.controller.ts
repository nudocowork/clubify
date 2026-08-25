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
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { SuperAdminService } from './superadmin.service';

class MessageTemplateBody {
  @IsOptional() @IsString() @MaxLength(4000) text?: string | null;
  /** Solo canal EMAIL: asunto del correo. */
  @IsOptional() @IsString() @MaxLength(200) subject?: string | null;
}
class FolderBody {
  @IsString() @MaxLength(60) name!: string;
}
class MoveBody {
  @IsString() @MaxLength(80) folderId!: string;
}
class EnabledBody {
  @IsBoolean() enabled!: boolean;
}
class TestPhoneBody {
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
}
class TestSendBody {
  @IsOptional() @IsString() @MaxLength(2000) text?: string | null;
}
class TestEmailAddrBody {
  @IsOptional() @IsString() @MaxLength(160) email?: string;
}
class TestEmailSendBody {
  @IsOptional() @IsString() @MaxLength(200) subject?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) body?: string | null;
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

  /**
   * Enlace de conexión de WhatsApp de la marca (lo pega el super admin en
   * /superadmin). El panel /admin lo convierte en un QR (Automatizaciones → QR
   * WhatsApp) sin mostrar el texto. Devuelve solo al admin de la propia marca.
   */
  @Get('whatsapp-qr')
  async whatsappQr(@CurrentUser() user: AuthUser) {
    const brandId = await this.resolveBrandId(user);
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id: brandId },
      select: { whatsappQrUrl: true },
    });
    return { url: wl?.whatsappQrUrl?.trim() || null };
  }

  /** Guarda el número de prueba de la marca. */
  @Patch('test-phone')
  async setTestPhone(@Body() body: TestPhoneBody, @CurrentUser() user: AuthUser) {
    return this.svc.setBrandTestPhone(await this.resolveBrandId(user), body.phone ?? '', user.id);
  }

  /** Guarda el correo de prueba de la marca. */
  @Patch('test-email')
  async setTestEmail(
    @Body() body: TestEmailAddrBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.setBrandTestEmail(
      await this.resolveBrandId(user),
      body.email ?? '',
      user.id,
    );
  }

  /** Manda el correo de una automatización al correo de prueba guardado. */
  @Post('message-templates/:templateId/test-email')
  async testEmailTemplate(
    @Param('templateId') templateId: string,
    @Body() body: TestEmailSendBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.testBrandEmailTemplate(
      await this.resolveBrandId(user),
      templateId,
      { subject: body.subject, body: body.body },
    );
  }

  /** Envía un SMS de prueba de una plantilla al número guardado. */
  @Post('message-templates/:templateId/test')
  async test(
    @Param('templateId') templateId: string,
    @Body() body: TestSendBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.testBrandMessage(await this.resolveBrandId(user), templateId, body.text ?? null);
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
      body.subject,
    );
  }

  @Patch('message-templates/:templateId/enabled')
  async setEnabled(
    @Param('templateId') templateId: string,
    @Body() body: EnabledBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.setBrandTemplateEnabled(
      await this.resolveBrandId(user),
      templateId,
      body.enabled,
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
