import { Body, Controller, ForbiddenException, Get, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
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

/** Body para PATCH /admin/landing-plans. Cada plan es opcional — el
 *  founder edita solo los que quiere actualizar desde /admin/branding. */
class LandingPlanItemDto {
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsString() @MaxLength(500) checkoutUrl?: string | null;
}
class LandingPlansDto {
  @IsOptional() mensual?: LandingPlanItemDto;
  @IsOptional() trimestral?: LandingPlanItemDto;
  @IsOptional() semestral?: LandingPlanItemDto;
  @IsOptional() anual?: LandingPlanItemDto;
}

class HotmartCouponDto {
  // null/string vacío para limpiar. Si no es string ni null, ValidationPipe
  // rechaza con 400 antes de llegar al service (sin esta clase el endpoint
  // aceptaba { foo: 'bar' } y crasheaba en .trim()).
  @IsOptional() @IsString() @MaxLength(200) couponCode?: string | null;
}

class TrialPolicyDto {
  // Tope de días de trial cuando la marca blanca no tiene créditos (0 = bloquear).
  @IsInt() @Min(0) @Max(365) maxTrialDaysNoCredits!: number;
}

// Mensaje pre-llenado del popup de bienvenida. La marca ({brand}) se resuelve
// del negocio (Sellea/Clubify) para no filtrar "Clubify" a marcas blancas.
const welcomePopupMessage = (brand: string) =>
  `Hola acabo de adquirir ${brand}, quiero agendar una sesión personalizada para mayor entendimiento de la plataforma.`;

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

  /** Planes de la landing pública (Mensual/Trimestral/Semestral/Anual)
   *  con precio USD + checkoutUrl. Lectura pública — la landing los
   *  renderiza en el toggle. Si un checkoutUrl falta, el botón del
   *  plan correspondiente queda como placeholder visual. */
  @Public()
  @Get('landing-plans')
  getLandingPlans() {
    return this.svc.getLandingPlans();
  }

  @Patch('admin/landing-plans')
  @Roles('SUPER_ADMIN', 'MARKETING')
  setLandingPlans(@Body() body: LandingPlansDto) {
    return this.svc.setLandingPlans(body);
  }

  /** Nombres de negocios ACTIVOS de Clubify — alimenta el marquee "Negocios
   *  LATAM creciendo con Clubify" de la landing. Lectura pública. */
  @Public()
  @Get('landing-active-businesses')
  getLandingActiveBusinesses() {
    return this.svc.getLandingActiveBusinesses();
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

  @Get('admin/trial-policy')
  @Roles('SUPER_ADMIN')
  getTrialPolicy() {
    return this.svc.getTrialPolicy();
  }

  @Patch('admin/trial-policy')
  @Roles('SUPER_ADMIN')
  setTrialPolicy(@Body() body: TrialPolicyDto) {
    return this.svc.setTrialPolicy(body.maxTrialDaysNoCredits);
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
        select: {
          status: true,
          welcomePopupSeenAt: true,
          whiteLabel: { select: { name: true } },
        },
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
      message: welcomePopupMessage(t?.whiteLabel?.name?.trim() || 'Clubify'),
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
