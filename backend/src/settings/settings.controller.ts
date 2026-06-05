import { Body, Controller, ForbiddenException, Get, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';
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
  @IsOptional() @IsString() landingLogoUrl?: string | null;
  @IsOptional() @IsString() faviconUrl?: string | null;
  @IsOptional() @IsString() supportWhatsapp?: string | null;
  @IsOptional() @IsString() welcomePopupImageUrl?: string | null;
  @IsOptional() @IsBoolean() welcomePopupEnabled?: boolean;
  @IsOptional() @IsString() scannerStaffPin?: string | null;
  @IsOptional() @IsString() salesWhatsapp?: string | null;
  @IsOptional() @IsString() salesEmail?: string | null;
  @IsOptional() @IsString() salesInstagram?: string | null;
  @IsOptional() @IsString() @MaxLength(40) landingStatBusinesses?: string | null;
  @IsOptional() @IsString() @MaxLength(40) landingStatWalletCustomers?: string | null;
  @IsOptional() @IsString() @MaxLength(40) landingStatOrders?: string | null;
  @IsOptional() @IsString() @MaxLength(40) landingStatRating?: string | null;
}

class PricingDto {
  @IsOptional() @IsNumber() @Min(0) eliteCost?: number;
  @IsOptional() @IsNumber() @Min(0) proCost?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
}

class HotmartCouponDto {
  // null/string vacío para limpiar. Si no es string ni null, ValidationPipe
  // rechaza con 400 antes de llegar al service (sin esta clase el endpoint
  // aceptaba { foo: 'bar' } y crasheaba en .trim()).
  @IsOptional() @IsString() @MaxLength(200) couponCode?: string | null;
}

const WELCOME_POPUP_MESSAGE =
  'Hola acabo de adquirir Clubify, quiero agendar una sesión personalizada para mayor entendimiento de la plataforma.';

@Controller()
export class SettingsController {
  constructor(
    private svc: SettingsService,
    private prisma: PrismaService,
  ) {}

  /** Público — el frontend del panel y landing leen branding desde aquí. */
  @Public()
  @Get('branding')
  getBranding() {
    return this.svc.getBranding();
  }

  /** Lectura admin del branding global. SUPER_ADMIN ve TODO (incluyendo
   *  el PIN sensible del escáner). MARKETING solo ve los campos de diseño
   *  — el PIN se filtra para no exponerlo al rol de marketing. */
  @Get('admin/branding')
  @Roles('SUPER_ADMIN', 'MARKETING')
  getBrandingAdmin(@CurrentUser() user: AuthUser) {
    if (user.role === 'MARKETING') {
      return this.svc.getBranding();
    }
    return this.svc.getBrandingAdmin();
  }

  /** SUPER_ADMIN y MARKETING pueden cambiar el branding global. MARKETING
   *  NO puede setear el scannerStaffPin — se descarta del body si lo manda. */
  @Patch('admin/branding')
  @Roles('SUPER_ADMIN', 'MARKETING')
  setBranding(@CurrentUser() user: AuthUser, @Body() body: BrandingDto) {
    if (user.role === 'MARKETING') {
      const { scannerStaffPin: _omit, ...safe } = body;
      void _omit;
      return this.svc.setBranding(safe);
    }
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

  /** Cupón Hotmart global — se preponne al checkout URL como
   *  ?couponCode=X para que Hotmart aplique el descuento. String vacío
   *  o null = sin cupón. */
  @Get('admin/billing/hotmart-coupon')
  @Roles('SUPER_ADMIN')
  getHotmartCoupon() {
    return this.svc.getHotmartCoupon();
  }

  @Patch('admin/billing/hotmart-coupon')
  @Roles('SUPER_ADMIN')
  setHotmartCoupon(@Body() body: HotmartCouponDto) {
    return this.svc.setHotmartCoupon(body.couponCode ?? null);
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
