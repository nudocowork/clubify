import { Body, Controller, ForbiddenException, Get, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';
import { SettingsService } from './settings.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { PrismaService } from '../common/prisma/prisma.service';

class BrandingDto {
  @IsOptional() @IsString() appLogoUrl?: string | null;
  @IsOptional() @IsString() faviconUrl?: string | null;
  @IsOptional() @IsString() supportWhatsapp?: string | null;
  @IsOptional() @IsString() welcomePopupImageUrl?: string | null;
  @IsOptional() @IsBoolean() welcomePopupEnabled?: boolean;
  @IsOptional() @IsString() scannerStaffPin?: string | null;
  @IsOptional() @IsString() salesWhatsapp?: string | null;
  @IsOptional() @IsString() salesEmail?: string | null;
  @IsOptional() @IsString() salesInstagram?: string | null;
}

class PricingDto {
  @IsOptional() @IsNumber() @Min(0) eliteCost?: number;
  @IsOptional() @IsNumber() @Min(0) proCost?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
}

const WELCOME_POPUP_MESSAGE =
  'Hola acabo de adquirir Clubify, quiero agendar una sesión personalizada para mayor entendimiento de la plataforma.';

@Controller()
export class SettingsController {
  constructor(
    private svc: SettingsService,
    private prisma: PrismaService,
  ) {}

  /** Público — el frontend del panel y landing leen branding desde acá. */
  @Public()
  @Get('branding')
  getBranding() {
    return this.svc.getBranding();
  }

  /** Super admin lee TODO incluyendo el PIN del escáner (sensitive). */
  @Get('admin/branding')
  @Roles('SUPER_ADMIN')
  getBrandingAdmin() {
    return this.svc.getBrandingAdmin();
  }

  /** Solo super admin puede cambiar el branding global. */
  @Patch('admin/branding')
  @Roles('SUPER_ADMIN')
  setBranding(@Body() body: BrandingDto) {
    return this.svc.setBranding(body);
  }

  /** Precios globales Elite/Pro usados por el módulo Cotizaciones.
   * Lectura: super admin (el módulo público no necesita esto todavía,
   * si más adelante se quiere exponer en landing se cambia a @Public). */
  @Get('admin/pricing')
  @Roles('SUPER_ADMIN')
  getPricing() {
    return this.svc.getPricing();
  }

  @Patch('admin/pricing')
  @Roles('SUPER_ADMIN')
  setPricing(@Body() body: PricingDto) {
    return this.svc.setPricing(body);
  }

  /**
   * Indica al frontend del panel si debe mostrar el popup de bienvenida.
   * Combina la config global (super admin) + estado del tenant actual
   * (no se mostró todavía, status ACTIVE).
   */
  @Get('welcome-popup/me')
  @Roles('TENANT_OWNER')
  async getWelcomePopup(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    const [branding, t] = await Promise.all([
      this.svc.getBranding(),
      this.prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: { status: true, welcomePopupSeenAt: true },
      }),
    ]);
    const shouldShow =
      branding.welcomePopupEnabled &&
      !!branding.welcomePopupImageUrl &&
      !!t &&
      t.status === 'ACTIVE' &&
      !t.welcomePopupSeenAt;
    return {
      shouldShow,
      imageUrl: branding.welcomePopupImageUrl,
      supportPhone: branding.supportWhatsapp,
      message: WELCOME_POPUP_MESSAGE,
    };
  }

  @Post('welcome-popup/dismiss')
  @Roles('TENANT_OWNER')
  async dismissWelcomePopup(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { welcomePopupSeenAt: new Date() },
    });
    return { ok: true };
  }
}
